#!/bin/bash
# Converts the test documents with EssayImport*.swift as they are now and as they are at HEAD, and compares the results.
# Usage: app/tools/importcheck/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
app="$here/../.."
root="$app/.."
out="$(mktemp -d)"
mkdir -p "$out/old"
for file in $(git -C "$root" ls-tree --name-only HEAD app/Sources/Apatite/ | grep '/EssayImport'); do
  git -C "$root" show "HEAD:$file" > "$out/old/$(basename "$file")"
done
docs=("$root"/testdata/import/*.docx "$root"/testdata/import/*.pdf "$root"/testdata/import/*.rtf "$root/testdata/Arguelles and March 2022 - Weeds (sample).pdf")
for which in old new; do
  sources=("$app"/Sources/Apatite/EssayImport*.swift)
  [ "$which" = old ] && sources=("$out"/old/*.swift)
  swiftc -O -o "$out/convert-$which" "$here/main.swift" "${sources[@]}" 2>&1 | grep -v warning || true
  "$out/convert-$which" "${docs[@]}" > "$out/$which.txt" 2>/dev/null
done
if cmp -s "$out/old.txt" "$out/new.txt"; then echo "SAME ($(wc -c < "$out/new.txt") bytes)"; else diff "$out/old.txt" "$out/new.txt" | head -40; exit 1; fi
