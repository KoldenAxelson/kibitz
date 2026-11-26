#!/bin/sh
# On a Mac, `npm start` runs the stock Electron.app from node_modules, so the
# menu bar and Dock say "Electron" whatever main.js calls the app (macOS takes
# the name from the bundle's Info.plist, not from the running code). This
# renames that dev copy to Kibitz and gives it Kibitz's icon. A packaged build
# (npm run package) never needs it. Safe to run again; `npm ci` undoes it.
set -e
[ "$(uname)" = Darwin ] || exit 0
app=node_modules/electron/dist/Electron.app
plist="$app/Contents/Info.plist"
[ -f "$plist" ] || { echo "dev-name: no $plist (run npm install first)"; exit 0; }
plutil -replace CFBundleName -string Kibitz "$plist"
plutil -replace CFBundleDisplayName -string Kibitz "$plist"
if [ -f build/icon.png ]; then
  sips -s format icns build/icon.png --out "$app/Contents/Resources/electron.icns" >/dev/null 2>&1 || true
fi
touch "$app"
echo "dev-name: the dev app is now called Kibitz"
