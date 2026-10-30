#!/bin/bash
# Builds "Apatite.app" with the Swift command line tools (no Xcode needed).
set -euo pipefail
cd "$(dirname "$0")"

# the notes page is built from its parts in ../web (it also writes ../apatite.html, the page on its own for the web)
python3 tools/make_notebook.py ../web Resources/notebook.html ../apatite.html >/dev/null

swift build -c release --arch arm64

APP="build/Apatite.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/arm64-apple-macosx/release/Apatite "$APP/Contents/MacOS/Apatite"
cp Info.plist "$APP/Contents/Info.plist"
cp Resources/notebook.html "$APP/Contents/Resources/"
cp Resources/seed-notebook.json "$APP/Contents/Resources/"
cp Resources/logo.png "$APP/Contents/Resources/"
cp Resources/welcome-*.png "$APP/Contents/Resources/"
cp -R Resources/katex "$APP/Contents/Resources/"
cp -R Resources/mathlive "$APP/Contents/Resources/"
if [ -f Resources/AppIcon.icns ]; then cp Resources/AppIcon.icns "$APP/Contents/Resources/"; fi
codesign --force --deep --sign - "$APP" >/dev/null
echo "Built $APP"

# install into ~/Applications (skip with NO_INSTALL=1)
if [ "${NO_INSTALL:-0}" != "1" ]; then
  mkdir -p "$HOME/Applications"
  ditto "$APP" "$HOME/Applications/Apatite.app"
  if pgrep -f "$HOME/Applications/Apatite.app/Contents/MacOS/Apatite" >/dev/null; then
    echo "Installed. Apatite is open: quit and reopen it to use the new version."
  else
    echo "Installed in ~/Applications."
  fi
fi
