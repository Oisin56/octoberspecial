#!/bin/bash
# Stand-in phone videos for the trimming tests (trimtest.mjs): the sizes, codecs and lengths that real
# iPhones and Android phones produce. Made with ffmpeg; skipped if already there.
set -euo pipefail
V=/var/tmp/ospg/testvid
mkdir -p "$V"
make() { # name seconds video-codec
  [ -f "$V/$1" ] && return
  echo "making $1"
  ffmpeg -v error -y -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=$2" -f lavfi -i "sine=frequency=440:sample_rate=48000:duration=$2" \
    -c:v "$3" -preset ultrafast -pix_fmt yuv420p -g 30 -c:a aac -b:a 128k ${4:-} "$V/$1"
}
make iphone-h264.mov 180 libx264
make iphone-hevc.mov 60 libx265 "-tag:v hvc1 -x265-params log-level=error"
make android.mp4 120 libx264
make long-tripod.mov 600 libx264
if [ ! -f "$V/tripod.webm" ]; then
  echo "making tripod.webm"
  ffmpeg -v error -y -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=150" -f lavfi -i "sine=frequency=330:sample_rate=48000:duration=150" \
    -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 1M -c:a libopus "$V/tripod.webm"
fi
