#!/usr/bin/env bash
# Renders og-image.png, apple-touch-icon.png and the app icons from the HTML
# sources in this folder using headless Chrome. Run from the repo root after
# design changes.
set -euo pipefail
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
ROOT="$(cd "$(dirname "$0")/.." && pwd -W 2>/dev/null || pwd)"

shot() { # shot <width> <height> <output> <source html + query>
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$1,$2" --screenshot="$ROOT/$3" "file:///$ROOT/scripts/$4"
}

shot 1200 630 og-image.png og-image.html
shot 180 180 apple-touch-icon.png "touch-icon.html?size=180"
shot 192 192 icon-192.png "touch-icon.html?size=192"
shot 512 512 icon-512.png "touch-icon.html?size=512"
shot 512 512 icon-maskable-512.png "touch-icon.html?size=512&maskable"
