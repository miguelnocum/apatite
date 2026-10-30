#!/bin/bash
# Checks the notebook page's scripts and styles (in ../../web). First time: npm ci (here, in app/tools).
#   ./check.sh            lint, formatting, and functions over 20 lines
#   ./check.sh --print    also writes the minified bundle to /tmp/apatite-page.min.js, to compare two versions
set -uo pipefail
cd "$(dirname "$0")"
WEB=../../web
TMP=$(mktemp -d)
python3 make_notebook.py "$WEB" "$TMP/notebook.html" "$TMP/page.html" >/dev/null || { rm -rf "$TMP"; exit 1; }   # also proves the modules bundle
echo "== lint (each module on its own, so a missing import is an undefined name)"
npx eslint --no-eslintrc --env browser,es2022 --parser-options=ecmaVersion:2022,sourceType:module --global katex,claude,MathfieldElement \
  --rule '{"no-undef":2,"no-unused-vars":[1,{"args":"none"}],"no-redeclare":2,"no-dupe-keys":2,"no-unreachable":2,"no-import-assign":2}' "$WEB/scripts" && echo "clean"
echo "== formatting"
npx prettier --config ../../.prettierrc.json --check "$WEB/scripts/**/*.js" "$WEB/styles/*.css" 2>&1 | tail -1
echo "== invisible characters (write them as \\u escapes)"
python3 - "$WEB/scripts" <<'PY'
import glob, sys
INVISIBLE = {0x01, 0xa0, 0x2002, 0x2003, 0x2009, 0x200b, 0x200c, 0x200d, 0x202f, 0x2060, 0x3000, 0xfeff}
found = 0
for path in sorted(glob.glob(sys.argv[1] + '/**/*.js', recursive=True)):
    for number, line in enumerate(open(path, encoding='utf8'), 1):
        codes = sorted({'U+%04X' % ord(c) for c in line if ord(c) in INVISIBLE})
        if codes:
            found += 1
            print('%s:%d %s' % (path[len(sys.argv[1]) + 1:], number, ' '.join(codes)))
print('none' if not found else '%d line(s)' % found)
PY
echo "== long functions"
node fnlen.js "$WEB/scripts" 20 15
if [ "${1:-}" = "--print" ]; then node bundle.js "$WEB/scripts" --minify > /tmp/apatite-page.min.js && echo "minified script: /tmp/apatite-page.min.js"; fi
rm -rf "$TMP"
