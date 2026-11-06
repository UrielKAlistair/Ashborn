#!/bin/bash
# Renders the app's icons from android/icon/ashborn-icon.svg (needs ImageMagick with librsvg):
# the Android launcher icons per density (the disc, cropped to the launcher's middle 72 units; and
# the scroll alone as the adaptive foreground), the tray icon (the scroll alone, cropped close, since
# a disc halves it at tray size), and the desktop app's icon.
#   scripts/make-icons.sh
set -euo pipefail
cd "$(dirname "$0")/.."

source=android/icon/ashborn-icon.svg
res=android/app/src/main/res
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The disc fills the frame; the foreground keeps the full canvas, without the disc
sed 's/viewBox="0 0 108 108"/viewBox="18 18 72 72"/' "$source" > "$work/disc.svg"
grep -v '<circle cx="54" cy="54"' "$source" > "$work/foreground.svg"
sed 's/viewBox="0 0 108 108"/viewBox="26 26 56 56"/' "$work/foreground.svg" > "$work/scroll.svg"

render() { magick -background none -density 1200 "$1" -resize "$2x$2" "$3"; }

for density in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  name=${density%%:*} size=${density##*:}
  render "$work/disc.svg" "$size" "$res/mipmap-$name/ic_launcher.png"
  render "$work/disc.svg" "$size" "$res/mipmap-$name/ic_launcher_round.png"
  render "$work/foreground.svg" $((size * 9 / 4)) "$res/mipmap-$name/ic_launcher_foreground.png"
done

render "$work/scroll.svg" 32 src/assets/ashborn-tray.png
render "$work/disc.svg" 512 src/assets/ashborn-icon.png
echo "Icons rendered from $source."
