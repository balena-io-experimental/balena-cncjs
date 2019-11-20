/**
 * @license
 * Copyright (C) 2018-2019  Balena Ltd.
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
import * as Bluebird from 'bluebird';
import { Message, systemBus } from 'dbus-native';
import * as _ from 'lodash';
import * as os from 'os';
import * as request from 'request-promise';

/**
 * Supervisor returned device details interface.
 */
interface HostDeviceDetails {
  api_port: string;
  ip_address: string;
  os_version: string;
  supervisor_version: string;
  update_pending: boolean;
  update_failed: boolean;
  update_downloaded: boolean;
  commit: string;
  status: string;
  download_progress: string | null;
}

/**
 * Supervisor returned device name interface.
 */
interface DeviceNameRespose {
  status: string;
  deviceName: string;
}

/**
 * Hosts published via Avahi.
 */
interface PublishedHosts {
  /** The Avahi group used to publish the host */
  group: string;
  /** The full hostname of the published host */
  hostname: string;
  /** The IP address of the published host */
  address: string;
}

/** List of published hosts */
const publishedHosts: PublishedHosts[] = [];

/** DBus controller */
const dbus = systemBus();
/**
 * DBus invoker.
 *
 * @param message DBus message to send
 */
const dbusInvoker = (message: Message): PromiseLike<any> => {
  return Bluebird.fromCallback(cb => {
    return dbus.invoke(message, cb);
  });
};

/**
 * Retrieves the IPv4 address for the named interface.
 *
 * @param intf Name of interface to query
 */
const getNamedInterfaceAddr = (intf: string): string => {
  const nics = os.networkInterfaces()[intf];

  if (!nics) {
    throw new Error('The configured interface is not present, exiting');
  }

  // We need to look for the IPv4 address
  let ipv4Intf;
  for (const nic of nics) {
    if (nic.family === 'IPv4') {
      ipv4Intf = nic;
      break;
    }
  }

  if (!ipv4Intf) {
    throw new Error(
      'IPv4 version of configured interface is not present, exiting',
    );
  }

  return ipv4Intf.address;
};

/**
 * Retrieve the IPv4 address for the default balena internet-connected interface.
 */
const getDefaultInterfaceAddr = async (): Promise<string> => {
  let deviceDetails: HostDeviceDetails | null = null;

  // We continue to attempt to get the default IP address every 10 seconds,
  // inifinitely, as without our service the rest won't work.
  while (!deviceDetails) {
    try {
      deviceDetails = await request({
        uri: `${process.env.BALENA_SUPERVISOR_ADDRESS}/v1/device?apikey=${
          process.env.BALENA_SUPERVISOR_API_KEY
          }`,
        json: true,
        method: 'GET',
      }).promise();
    } catch (_err) {
      console.log(
        'Could not acquire IP address from Supervisor, retrying in 10 seconds',
      );
      await Bluebird.delay(10000);
    }
  }

  // Ensure that we only use the first returned IP address route. We don't want to broadcast
  // on multiple subnets.
  return deviceDetails.ip_address.split(' ')[0];
};

const getDeviceName = async (): Promise<string> => {
  let deviceNameResponse: DeviceNameRespose | null = null;

  while (!deviceNameResponse) {
    try {
      deviceNameResponse = await request({
        uri: `${process.env.BALENA_SUPERVISOR_ADDRESS}/v2/device/name?apikey=${process.env.BALENA_SUPERVISOR_API_KEY}`,
        json: true, method: 'GET'
      }).promise();
    } catch (_err) {
      console.log('Could not acquire device name from Supervisor, retrying in 10 seconds');
      await Bluebird.delay(10000);
    }
  }

  return deviceNameResponse.deviceName;
}

/**
 * Retrieve a new Avahi group for address publishing.
 */
const getGroup = async (): Promise<string> => {
  return await dbusInvoker({
    destination: 'org.freedesktop.Avahi',
    path: '/',
    interface: 'org.freedesktop.Avahi.Server',
    member: 'EntryGroupNew',
  });
};

/**
 * Add a host address to the local domain.
 *
 * @param hostname Full hostname to publish
 * @param address  IP address for the hostname
 */
const addHostAddress = async (
  hostname: string,
  address: string,
): Promise<void> => {
  // If the hostname is already published with the same address, return
  if (_.find(publishedHosts, { hostname, address })) {
    return;
  }

  console.log(`Adding ${hostname} at address ${address} to local MDNS pool`);

  // We require a new group for each address.
  // We don't catch errors, as our restart policy is to not restart.
  const group = await getGroup();

  await dbusInvoker({
    destination: 'org.freedesktop.Avahi',
    path: group,
    interface: 'org.freedesktop.Avahi.EntryGroup',
    member: 'AddAddress',
    body: [-1, -1, 0x10, hostname, address],
    signature: 'iiuss',
  });

  await dbusInvoker({
    destination: 'org.freedesktop.Avahi',
    path: group,
    interface: 'org.freedesktop.Avahi.EntryGroup',
    member: 'Commit',
  });

  // Add to the published hosts list
  publishedHosts.push({
    group,
    hostname,
    address,
  });
};

/**
 * Remove hostname from published list
 *
 * @param hostname Hostname to remove from list
 * @param address IP address to remove from list
 */
const removeHostAddress = async (hostname: string, address: string): Promise<void> => {
  // If the hostname doesn't exist, we don't use it
  const hostDetails = _.find(publishedHosts, { hostname, address });
  if (!hostDetails) {
    return;
  }

  console.log(`Removing ${hostname} at address from local MDNS pool`);

  // Free the group, removing the published address
  await dbusInvoker({
    destination: 'org.freedesktop.Avahi',
    path: hostDetails.group,
    interface: 'org.freedesktop.Avahi.EntryGroup',
    member: 'Free',
  });

  // Remove from the published hosts list
  _.remove(publishedHosts, { hostname });
};


const publishNameAndAddress = async (): Promise<void> => {
  let address: string;
  // Get IP address for the specified interface.
  if (process.env.INTERFACE) {
    address = getNamedInterfaceAddr(process.env.INTERFACE);
  } else {
    address = await getDefaultInterfaceAddr();
  }

  let deviceName: string = await getDeviceName();
  let hostname: string = `${deviceName}.local`;

  if (!_.find(publishedHosts, { hostname, address })) {
    publishedHosts.forEach(async ({ hostname, address }) => await removeHostAddress(hostname, address));
    addHostAddress(hostname, address)
  }

  return;
}

(async () => {
  try {
    while (true) {
      await publishNameAndAddress();
      await Bluebird.delay(10000);
    }

  } catch (err) {
    console.log(`balena MDNS publisher error:\n${err}`);
    // This is not ideal. However, dbus-native does not correctly free connections
    // on event loop exit
    process.exit(1);
  }
})();
