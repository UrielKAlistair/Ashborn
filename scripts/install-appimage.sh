#!/bin/bash
# Installs the desktop app once: copies the AppImage built by `npm run appimage` to
# ~/Applications/Ashborn.AppImage and registers it to start at login, hidden in the tray.
# Deleting the AppImage is enough to remove it: GNOME skips an autostart entry whose TryExec
# file is missing. The entry itself is ~/.config/autostart/ashborn.desktop.
#   scripts/install-appimage.sh
set -euo pipefail

source="$(dirname "$0")/../release/Ashborn.AppImage"
target="$HOME/Applications/Ashborn.AppImage"
entry="$HOME/.config/autostart/ashborn.desktop"

[ -f "$source" ] || { echo "No $source: run npm run appimage first." >&2; exit 1; }
mkdir -p "$(dirname "$target")" "$(dirname "$entry")"
install -m 755 "$source" "$target"

cat > "$entry" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Ashborn
Comment=Starts Ashborn in the tray at login
TryExec=$target
Exec="$target" --hidden
Terminal=false
DESKTOP

echo "Installed $target; it starts at login from $entry."
