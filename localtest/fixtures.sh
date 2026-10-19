#!/bin/bash
# Stand-in phone videos for the trimming tests (trimtest.mjs): the sizes, codecs and lengths that real
# iPhones and Android phones produce. Silent except for a sharp "strike" at 40s and 90s, which the test listens
# for to check each cut lands in the right place. Made with ffmpeg; skipped if already there.
set -euo pipefail
V=/var/tmp/ospg/testvid
mkdir -p "$V"
STRIKES="if(between(t,40,40.055)+between(t,90,90.055),0.9*sin(2*PI*1500*t),0)"
make() { # name seconds video-codec [extra]
  [ -f "$V/$1" ] && return
  echo "making $1"
  ffmpeg -v error -y -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=$2" -f lavfi -i "aevalsrc='$STRIKES':s=48000:d=$2" \
    -c:v "$3" -preset ultrafast -pix_fmt yuv420p -g 30 -c:a aac -b:a 128k ${4:-} "$V/$1"
}
make iphone-h264.mov 180 libx264
make iphone-hevc.mov 60 libx265 "-tag:v hvc1 -x265-params log-level=error"
make android.mp4 120 libx264
STRIKES=0 make long-tripod.mov 600 libx264
if [ ! -f "$V/tripod.webm" ]; then
  echo "making tripod.webm"
  ffmpeg -v error -y -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=150" -f lavfi -i "aevalsrc='$STRIKES':s=48000:d=150" \
    -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 1M -c:a libopus "$V/tripod.webm"
fi

# Stand-in photos (any JPEG will do): one to upload, two already in storage for the news tests
P=/var/tmp/ospg/files/photo/october-special-2026
mkdir -p "$P"
jpg() { [ -f "$1" ] || ffmpeg -v error -y -f lavfi -i "gradients=size=$2:seed=$3" -frames:v 1 -q:v 4 "$1"; }
jpg /var/tmp/ospg/hero.jpg 1800x1000 1
jpg "$P/hero.jpg" 1800x1000 1
jpg "$P/0000aaaa-1111-2222-3333-444455556666.jpg" 900x500 2
