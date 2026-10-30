#!/bin/bash
# Builds HEAD (in a temporary worktree) and the working copy, takes the screenshot test's pictures with each, and
# lists the pictures that differ. (The welcome screen animates, so its picture can differ between any two runs.)
# Usage: app/tools/shotcompare.sh   — pictures are kept in app/tools/_shots/{old,new}
set -uo pipefail
app="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "$app/.." && pwd)"
PDF="$root/testdata/Arguelles and March 2022 - Weeds (sample).pdf"
out="$app/tools/_shots"
tree="$(mktemp -d)/head"
rm -rf "$out"; mkdir -p "$out"
git -C "$root" worktree add --detach "$tree" HEAD >/dev/null 2>&1 || { echo "could not make a worktree"; exit 1; }
# both with the test suites in; a HEAD from before APATITE_TESTS ignores the variable and has them in its normal build
(cd "$tree/app" && NO_INSTALL=1 APATITE_TESTS=1 ./build.sh 2>&1 | grep -E "error|Built")
(cd "$app" && APATITE_TESTS=1 ./build.sh 2>&1 | grep -E "error|Built")
bundle() { if [ -d "$1/build-tests/Apatite.app" ]; then echo "$1/build-tests/Apatite.app"; else echo "$1/build/Apatite.app"; fi; }
shoot() { # shoot <app bundle> <name>
  local lib="$out/lib-$2"; mkdir -p "$lib"
  env APATITE_LIBRARY="$lib" APATITE_VIEWSHOTS=1 APATITE_SHOTPDF="$PDF" "$1/Contents/MacOS/Apatite" >/dev/null 2>&1 &
  local pid=$!
  for _ in $(seq 1 90); do [ -f "$lib/shots/done.txt" ] && break; /bin/sleep 1; done
  /bin/sleep 1; kill $pid 2>/dev/null; wait $pid 2>/dev/null
  mv "$lib/shots" "$out/$2"
}
shoot "$(bundle "$tree/app")" old
shoot "$(bundle "$app")" new
git -C "$root" worktree remove --force "$tree" >/dev/null 2>&1
differ=0
for f in "$out"/old/*.png "$out"/new/*.png; do
  name=$(basename "$f"); other="$out/old/$name"; [ "$f" = "$other" ] && other="$out/new/$name"
  if [ ! -f "$other" ]; then echo "only in $(basename "$(dirname "$f")"): $name"; differ=1
  elif [[ "$f" == "$out/old/"* ]] && ! cmp -s "$f" "$other"; then echo "differs: $name"; differ=1; fi
done
if ! cmp -s "$out/old/menus.txt" "$out/new/menus.txt"; then echo "menus differ:"; diff "$out/old/menus.txt" "$out/new/menus.txt"; differ=1; fi
[ $differ = 0 ] && echo "SAME"
