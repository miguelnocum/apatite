#!/bin/bash
# Builds the app (without installing) and runs its focus-mode check in a throwaway library: pictures of the window in
# focus mode at a few sizes, zoomed, with a menu open from the bar and with a selection, and a report of what the
# window and page are doing. Your own Apatite (and its notes) is left alone.
# Usage: app/tools/focusshots.sh   — pictures and report in app/tools/_focus/
set -uo pipefail
app="$(cd "$(dirname "$0")/.." && pwd)"
out="$app/tools/_focus"
(cd "$app" && NO_INSTALL=1 ./build.sh 2>&1 | grep -E "error|Built") || exit 1
rm -rf "$out"; mkdir -p "$out/lib"
env APATITE_LIBRARY="$out/lib" APATITE_FOCUSTEST=1 "$app/build/Apatite.app/Contents/MacOS/Apatite" >/dev/null 2>&1 &
pid=$!
for _ in $(seq 1 60); do [ -f "$out/lib/focus/report.txt" ] && break; /bin/sleep 1; done
/bin/sleep 1; kill $pid 2>/dev/null; wait $pid 2>/dev/null
if [ ! -f "$out/lib/focus/report.txt" ]; then echo "no report"; exit 1; fi
mv "$out/lib/focus"/* "$out/" && rm -rf "$out/lib"
cat "$out/report.txt"
