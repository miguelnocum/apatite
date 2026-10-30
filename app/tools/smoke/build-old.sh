#!/bin/bash
# Builds the page as of a commit or tag (default: the last commit) into app/Resources/notebook-old.html, and the working
# copy's into app/Resources/notebook.html, so the smoke test can compare them (see page-smoke.js).
# Usage: app/tools/smoke/build-old.sh [rev=HEAD]        e.g.  build-old.sh phase0-baseline
# serve.py serves them as /native/notebook-old.html and /native/notebook.html (with the fake Mac bridge in front) and as
# /app/Resources/… (the web page, as it is). Both files are generated and not kept in git.
set -euo pipefail
cd "$(dirname "$0")/../../.."
REV=${1:-HEAD}
git rev-parse --verify --quiet "$REV^{commit}" >/dev/null || { echo "no such commit or tag: $REV" >&2; exit 1; }
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
# the old page is built with the old build script: the layout of web/ (flat files, or folders and order.txt) changed over time
# (a revision from Phase 2 on bundles with app/tools/bundle.js, which finds esbuild in the node_modules of this checkout)
git archive "$REV" web app/tools/make_notebook.py $(git ls-tree --name-only "$REV" app/tools/bundle.js) | tar -x -C "$TMP"
ln -s "$PWD/app/tools/node_modules" "$TMP/app/tools/node_modules"
python3 "$TMP/app/tools/make_notebook.py" "$TMP/web" app/Resources/notebook-old.html >/dev/null
python3 app/tools/make_notebook.py web app/Resources/notebook.html >/dev/null
echo "built notebook-old.html ($REV) and notebook.html (working copy)"
