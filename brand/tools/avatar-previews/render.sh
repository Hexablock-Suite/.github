#!/usr/bin/env bash
# Render the preview wrappers with snap Chromium.
# Snap Chromium cannot read the system temp folder or hidden home folders,
# so every file lives in the preview dir. Use a visible folder in your home.
# Usage: bash render.sh <absolute preview dir>
set -euo pipefail
dir=$1
shot() {  # wrapper name, width, height
  chromium --headless --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --window-size="$2,$3" --screenshot="$dir/${1%.html}.png" "file://$dir/$1" 2>/dev/null
}
shot avatar.html 1024 1024
shot social-hexablock-app.html 1280 640
shot social-hexablock-api.html 1280 640
# Chromium has a minimum window size, so the 40 px avatar sits in the top-left corner of a larger shot.
shot avatar-40.html 400 200
