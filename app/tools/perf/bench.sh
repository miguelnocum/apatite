#!/bin/bash
# Performance baseline: builds the app (without installing), makes synthetic libraries (mklib.py) and runs the app's perf
# test (APATITE_PERFTEST, tests/TestsPerf.swift) on each in a throwaway library. The test opens a paper, scrolls it, opens the
# notebook and types in it while a heartbeat in the app and one in the page count freezes over 50 ms; it also times the
# notebook's flush and the app's persist (the page's whole state written to files).
# Usage: tools/perf/bench.sh                 the three standard libraries, report on stdout (perf-baseline.txt is one such run)
#        tools/perf/bench.sh <name> <mklib.py arguments after the directory and the PDF…>     one library of your own
# Libraries are made in tools/_perf/<name>/ and removed at the end; each run takes about half a minute.
set -uo pipefail
cd "$(dirname "$0")/../.."
ROOT="$(cd .. && pwd)"
PDF="$ROOT/testdata/Arguelles and March 2022 - Weeds (sample).pdf"
OUT="$PWD/tools/_perf"
BIN="$PWD/build-tests/Apatite.app/Contents/MacOS/Apatite"

APATITE_TESTS=1 ./build.sh 2>&1 | grep -E "error|warning: unre|Built" || exit 1
[ -x "$BIN" ] || { echo "no binary at $BIN" >&2; exit 1; }

bench() {  # bench <name> <mklib.py arguments…>
  local name=$1; shift
  local lib="$OUT/$name"
  rm -rf "$lib"; mkdir -p "$lib"
  defaults delete local.tracy.apatite.tests 2>/dev/null
  local made; made=$(python3 tools/perf/mklib.py "$lib" "$PDF" "$@") || { echo "== $name: mklib.py failed"; return 1; }
  echo "== $name: mklib.py $*"
  [ -n "$made" ] && echo "$made"
  echo "   library on disk: $(du -sk "$lib" | cut -f1) KB; Big/Notebooks/Notes.json $(( $(stat -f %z "$lib/Big/Notebooks/Notes.json") / 1024 )) KB; Big/Essays $(du -sk "$lib/Big/Essays" | cut -f1) KB"
  env APATITE_LIBRARY="$lib" APATITE_PERFTEST=1 "$BIN" >/dev/null 2>&1 &
  local pid=$!
  for _ in $(seq 1 90); do [ -f "$lib/perftest.txt" ] && break; /bin/sleep 1; done
  /bin/sleep 1; kill $pid 2>/dev/null; wait $pid 2>/dev/null
  if [ -f "$lib/perftest.txt" ]; then cat "$lib/perftest.txt"; echo; else echo "NO REPORT"; fi
  echo
}

if [ $# -gt 0 ]; then bench "$@"
else
  echo "Apatite perf baseline, $(date '+%Y-%m-%d %H:%M'), $(git rev-parse --short HEAD 2>/dev/null) on $(sysctl -n machdep.cpu.brand_string), macOS $(sw_vers -productVersion)"
  echo
  bench small 60 3 30 40
  bench big 1500 40 80 400
  bench images 300 6 40 100 --images 6 --image-px 200 --equations 30
fi
defaults delete local.tracy.apatite.tests 2>/dev/null   # the test build's own bundle id (see build.sh), never the real app's
rm -rf "$OUT"
