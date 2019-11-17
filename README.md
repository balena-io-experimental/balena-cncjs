# Balena CNC

This repo allows you to install [CNC.js](https://cnc.js.org/) on a [Balena](https://balena.io) device with a supported CNC machine connected to either `/dev/ttyAMA0` (the build-in serial UART) or `/dev/ttyUSB0` for USB-connected controllers.

This repo has been tested with a "3018 Pro" hobby CNC machine.

## Installation

1. A [Balena-supported device](https://www.balena.io/docs/reference/hardware/devices/) (I used an old Raspberry Pi 2B I had sitting around).
2. A [free Balena account](https://dashboard.balena-cloud.com/signup).
3. Install [Balena CLI](https://www.balena.io/docs/reference/cli/) as per [the instructions](https://github.com/balena-io/balena-cli/blob/master/INSTALL.md).
4. Run `balena login` to give the CLI access to your account (if you haven't already).
5. Run `balena devices supported` to find the SLUG for the device you are using.
6. Run `balena app create CNCMachine --type <device-slug>`. In my case I used `raspberry-pi2` for the device slug.
7. Download and flash a balenaOS image for your application.  The easiest way is to click "add device" in the Balena dashboard (don't forget to set the WiFi credentials if needed) and use [Etcher](https://www.balena.io/etcher/) to write the image to your device or an SD card.
8. Run `balena env add RESIN_HOST_CONFIG_gpu_mem 128 --application CNCMachine` and `balena env add RESIN_HOST_CONFIG_start_x 1 --application CNCMachine` to enable the Raspbery Pi camera module.
9. Power on your device.
10. Clone or download this repo.
11. Run `balena push CNCMachine` in the downloaded repo folder.

Balena Cloud will now build the configuration and docker images for your device and deploy them to your application.  You should be able to connect to your device over HTTP to see CNC.js.

## Usage

In the Balena Cloud dashboard you should be able to see your device's IP address on your local network.  Open your browser and type `http://A.B.C.D/` replacing `A.B.C.D` with the IP address of your device.  If you require remote access to your device you can enable the public device URL feature on balena cloud and access it via a generated HTTPS URL.  If you enable public access I strongly encourage you to enable authentication in the CNC.js UI.

### Connecting to your CNC machine

In the top-left widget of the CNC.js homepage you are able to connect to your device via serial. You should see `/dev/ttyAMA0` and/or `/dev/ttyUSB0` in the drop-down list.  If your device connects via a different device you will need to edit the `docker-compose.yml` file in this repository to add it to the list of devices that CNC.js is allowed to access.

Remember to run `balena push CNCMachine` whenever you make changes so that they can be built and deployed to your devices.

### Using a Raspberry Pi camera

I use a Raspberry Pi camera to help monitor my jobs.  You will need to configure the camera widget to manually connect to `/camera?action=stream`.

If you don't have or don't want to use a Raspberry Pi camera (or you're not even using a Raspberry Pi!) then you will need follow the instructions in `proxy/nginx.conf` and `docker-compose.yml` to remove camera support.

Remember to run `balena push CNCMachine` whenever you make changes so that they can be built and deployed to your devices.


