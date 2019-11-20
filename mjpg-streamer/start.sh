#!/bin/sh

if [ -e $1 ]; then
  /usr/local/bin/mjpg_streamer -i "input_uvc.so -r 1280x720 -d $1 -f 30" -o "output_http.so -p 8080 -w /usr/local/share/mjpg-streamer/www"
else
  echo "Not starting mjpg-streamer because no camera is detected"
  sleep infinity
fi
