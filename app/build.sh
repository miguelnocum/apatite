#!/bin/bash
# Builds "Apatite.app" with the Swift command line tools (no Xcode needed).
set -euo pipefail
cd "$(dirname "$0")"

# the notes page is built from its parts in ../web (it also writes ../apatite.html, the page on its own for the web)
python3 tools/make_notebook.py ../web Resources/notebook.html ../apatite.html >/dev/null

# APATITE_TESTS=1 builds the app with its test suites compiled in (the APATITE_TESTS condition), for tools/regress.sh and the
# other tools that run them. That build has its own folders (.build-tests, build-tests) and is never installed; a normal build
# has no test code at all.
FLAGS=(); OUT="build"
if [ "${APATITE_TESTS:-0}" = "1" ]; then
  FLAGS=(-Xswiftc -DAPATITE_TESTS --scratch-path .build-tests); OUT="build-tests"; NO_INSTALL=1
fi

swift build -c release --arch arm64 ${FLAGS[@]+"${FLAGS[@]}"}
# where the binary lands depends on the toolchain (command line tools: .build/arm64-apple-macosx/release; Xcode: .build/out/Products/Release)
BIN="$(swift build -c release --arch arm64 ${FLAGS[@]+"${FLAGS[@]}"} --show-bin-path)/Apatite"

APP="$OUT/Apatite.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Apatite"
cp Info.plist "$APP/Contents/Info.plist"
# the test build has its own bundle id, so a test run reads and writes its own preferences (window frames and the like), never the
# real app's; only this copy of the Info.plist is changed, never Info.plist itself
if [ "${APATITE_TESTS:-0}" = "1" ]; then
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier local.tracy.apatite.tests" "$APP/Contents/Info.plist"
fi
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
