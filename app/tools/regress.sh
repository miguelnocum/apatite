#!/bin/bash
# Builds the app (without installing) and runs its built-in test suites, each in a throwaway library.
# Usage: tools/regress.sh [suite …]   (default: self project reader org deck folder window import; also: link)
# Reports are kept in tools/_regress/<suite>/. Each is normalised (ids, uuids and times blanked) and compared with the
# report saved in tools/regress-baseline/; a suite PASSes when they match and FAILs on any difference (shown as a diff),
# a missing report, or a missing baseline. The exit status is non-zero if any suite failed.
#   tools/regress.sh --update [suite …]   saves the reports of this run as the new baselines (read the diff first)
# The reports mention "false" and the like on purpose (a wrong answer rejected, a wheel that closed), so there is no
# word list: a line that is right today is in the baseline, and anything that changes shows up.
set -uo pipefail
cd "$(dirname "$0")/.."
ROOT="$(cd .. && pwd)"
PDF="$ROOT/testdata/Arguelles and March 2022 - Weeds (sample).pdf"
OUT="$PWD/tools/_regress"
BIN="$PWD/build/Apatite.app/Contents/MacOS/Apatite"
BASE="$PWD/tools/regress-baseline"
UPDATE=0
if [ "${1:-}" = "--update" ]; then UPDATE=1; shift; fi
RESULTS=()

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
}

# the report with what differs between runs blanked: ids, uuids, times, the library's path, the order of JSON keys
normalise() { python3 "$PWD/tools/regress-normalise.py" "$1" "$OUT"; }

# verdict <suite> <report file>: PASS or FAIL against the baseline
verdict() {
  local name=$1 file=$2 report="$OUT/$1/$2" base="$BASE/$2"
  if [ ! -f "$report" ]; then printf "%-8s FAIL (no report)\n" "$name"; RESULTS+=(1); return; fi
  if [ "$UPDATE" = 1 ]; then mkdir -p "$BASE"; normalise "$report" >"$base"; printf "%-8s baseline saved\n" "$name"; return; fi
  if [ ! -f "$base" ]; then printf "%-8s FAIL (no baseline: run with --update once the report is checked)\n" "$name"; RESULTS+=(1); return; fi
  if normalise "$report" | diff -u "$base" - >"$OUT/$name.diff"; then
    printf "%-8s PASS\n" "$name"
  else
    printf "%-8s FAIL (< baseline, > this run)\n" "$name"; sed 's/^/           /' "$OUT/$name.diff"; RESULTS+=(1)
  fi
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
for s in $SUITES; do
  case $s in
    self) verdict self selftest.txt ;;       project) verdict project projecttest.txt ;;
    reader) verdict reader readertest.txt ;; org) verdict org orgtest.txt ;;
    deck) verdict deck decktest.txt ;;       folder) verdict folder foldertest.txt ;;
    link) verdict link linktest.txt ;;       window) verdict window windowtest.txt ;;
    import) verdict import importtest.txt ;;
  esac
done
echo "Reports: $OUT"
if [ ${#RESULTS[@]} -gt 0 ]; then echo "${#RESULTS[@]} suite(s) FAILED"; exit 1; fi
[ "$UPDATE" = 1 ] && echo "baselines saved in $BASE" || echo "all suites passed"
