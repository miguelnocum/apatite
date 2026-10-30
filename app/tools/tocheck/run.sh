#!/bin/bash
# Reads the test PDFs' contents with ReaderTOC as it is now and as it is at HEAD, and compares the results.
# Usage: app/tools/tocheck/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
app="$here/../.."
root="$app/.."
out="$(mktemp -d)"
if git -C "$root" cat-file -e HEAD:app/Sources/Apatite/ReaderTOC.swift 2>/dev/null; then
  git -C "$root" show HEAD:app/Sources/Apatite/ReaderTOC.swift > "$out/old.swift"
else # (before ReaderTOC had a file of its own)
  git -C "$root" show HEAD:app/Sources/Apatite/ReaderContents.swift |
    python3 -c "import sys; s=sys.stdin.read(); print('import PDFKit\n' + s[s.index('/// One line of a PDF'):s.index('extension AppState {')])" > "$out/old.swift"
fi
docs=("$root"/testdata/contents/*.pdf "$root"/testdata/import/*.pdf "$root"/testdata/*.pdf)
for which in old new; do
  source="$app/Sources/Apatite/ReaderTOC.swift"
  [ "$which" = old ] && source="$out/old.swift"
  swiftc -O -o "$out/toc-$which" "$here/main.swift" "$source" 2>&1 | grep -v warning || true
  "$out/toc-$which" "${docs[@]}" > "$out/$which.txt" 2>/dev/null
done
if cmp -s "$out/old.txt" "$out/new.txt"; then echo "SAME ($(wc -l < "$out/new.txt") lines)"; else diff "$out/old.txt" "$out/new.txt" | head -40; exit 1; fi
