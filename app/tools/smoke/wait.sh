#!/bin/bash
# Waits for a smoke report to be written since the pages were last built, then prints how long it waited.
# Usage: app/tools/smoke/wait.sh <name> [timeout seconds=540]   (a run takes 5 to 10 minutes; stay under the shell's 10 minute limit)
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$here/reports"
cd "$here/reports" || exit 1
name=$1
limit=${2:-540}
start=$(date +%s)
built=$(stat -f %m "$here/../../Resources/notebook.html" 2>/dev/null || echo 0)
while :; do
  now=$(stat -f %m "$name.json" 2>/dev/null || echo 0)
  if [ "$now" != 0 ] && [ "$now" -ge "$built" ]; then echo "$name.json written ($(( $(date +%s) - start ))s waited)"; exit 0; fi
  if [ $(( $(date +%s) - start )) -ge "$limit" ]; then echo "timed out waiting for $name.json"; exit 1; fi
  sleep 1
done
