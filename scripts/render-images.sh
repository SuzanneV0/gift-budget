#!/usr/bin/env bash
# Renders og-image.png and apple-touch-icon.png from the HTML sources in this
# folder using headless Chrome. Run from the repo root after design changes.
set -euo pipefail
CHROME="${CHROME:-/c/Program Files/Google/Chrome/Application/chrome.exe}"
ROOT="$(cd "$(dirname "$0")/.." && pwd -W 2>/dev/null || pwd)"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1200,630 --screenshot="$ROOT/og-image.png" "file:///$ROOT/scripts/og-image.html"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=180,180 --screenshot="$ROOT/apple-touch-icon.png" "file:///$ROOT/scripts/touch-icon.html"
