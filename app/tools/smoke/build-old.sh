#!/bin/bash
# Builds the page as last committed (or as of a given commit) into app/Resources/notebook-old.html,
# so the smoke test can compare it with the working copy's app/Resources/notebook.html.
# Usage: app/tools/smoke/build-old.sh [commit=HEAD]
set -euo pipefail
cd "$(dirname "$0")/../../.."
TMP=$(mktemp -d)
git archive "${1:-HEAD}" web | tar -x -C "$TMP"
python3 app/tools/make_notebook.py "$TMP/web" app/Resources/notebook-old.html >/dev/null
python3 app/tools/make_notebook.py web app/Resources/notebook.html >/dev/null
rm -rf "$TMP"
echo "built notebook-old.html (${1:-HEAD}) and notebook.html (working copy)"
