#!/bin/bash
# Builds the app (without installing) and runs its built-in test suites, each in a throwaway library.
# Usage: tools/regress.sh [suite …]   (default: self project reader org deck folder window import; also: link)
# Reports are kept in tools/_regress/<suite>/; the summary counts lines that look like failures.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(cd .. && pwd)"
PDF="$ROOT/testdata/Arguelles and March 2022 - Weeds (sample).pdf"
OUT="$PWD/tools/_regress"
BIN="$PWD/build/Apatite.app/Contents/MacOS/Apatite"
FAIL='no pdf|NONE|NO |FAIL|NOT FOUND|NOT INSERTED|ERR|BROKEN|NOT OFFERED|not found|false'

NO_INSTALL=1 ./build.sh 2>&1 | grep -E "error|warning: unre|Built" || exit 1
rm -rf "$OUT"; mkdir -p "$OUT"

run() {  # run <suite> <report file> <env…>
  local name=$1 file=$2; shift 2
  local lib="$OUT/$name"; mkdir -p "$lib"
  local before; before=$(cat "$lib/$file" 2>/dev/null | wc -l)
  env APATITE_LIBRARY="$lib" "$@" "$BIN" >/dev/null 2>&1 &
  local pid=$!
  # a report that already exists (the window test's second launch) has to grow
  for _ in $(seq 1 60); do [ -f "$lib/$file" ] && [ "$(wc -l <"$lib/$file")" != "$before" -o "$before" = 0 ] && break; /bin/sleep 1; done
  /bin/sleep 1; kill $pid 2>/dev/null; wait $pid 2>/dev/null
  if [ ! -f "$lib/$file" ]; then printf "%-8s NO REPORT\n" "$name"; return; fi
  printf "%-8s %s suspicious line(s)\n" "$name" "$(grep -cE "$FAIL" "$lib/$file" | tr -d ' ')"
}

# (shots saves a picture of each screen into tools/_regress/shots/shots/, to compare two builds; not in the default list)
# (the link suite needs a prepared library with an essay "es1" and a Prince source, so it is not in the default list)
SUITES=${*:-self project reader org deck folder window import}
for s in $SUITES; do
  case $s in
    self)    run self selftest.txt APATITE_SELFTEST="$PDF" ;;
    project) run project projecttest.txt APATITE_PROJECTTEST=1 ;;
    reader)  run reader readertest.txt APATITE_READERTEST="$PDF" ;;
    org)     run org orgtest.txt APATITE_ORGTEST=1 ;;
    deck)    run deck decktest.txt APATITE_DECKTEST=1 ;;
    folder)  F="$OUT/folder-src"; mkdir -p "$F/Week 1"; cp "$PDF" "$F/a.pdf"; cp "$PDF" "$F/Week 1/b.pdf"
             run folder foldertest.txt APATITE_FOLDERTEST="$F" ;;
    link)    run link linktest.txt APATITE_LINKTEST="$PDF" ;;
    shots)   run shots shots/done.txt APATITE_VIEWSHOTS=1 APATITE_SHOTPDF="$PDF" ;;
    window)  run window windowtest.txt APATITE_WINDOWTEST="$PDF"; run window windowtest.txt APATITE_WINDOWTEST="$PDF" ;;
    import)  run import importtest.txt APATITE_IMPORTTEST="$ROOT/testdata/import/Word essay.docx|$ROOT/testdata/import/PDF essay.pdf" ;;
  esac
done
defaults delete local.tracy.apatite.tests 2>/dev/null
echo "Reports: $OUT"
