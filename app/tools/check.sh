#!/bin/bash
# Checks the notebook page's scripts and styles (in ../../web). First time: npm install (here, in app/tools).
#   ./check.sh            lint, formatting, and functions over 20 lines
#   ./check.sh --print    also writes the minified script to /tmp/apatite-page.min.js, to compare two versions
set -uo pipefail
cd "$(dirname "$0")"
WEB=../../web
TMP=$(mktemp -d)
python3 make_notebook.py "$WEB" "$TMP/notebook.html" "$TMP/page.html" >/dev/null
# the script, as the page runs it (all files in one scope)
python3 - "$TMP/page.html" "$TMP/page.js" <<'PY'
import sys
s = open(sys.argv[1], encoding='utf8').read()
start = s.index('<script>\n(function(){')
open(sys.argv[2], 'w', encoding='utf8').write(s[start + len('<script>\n'):s.rindex('</script>')])
PY
echo "== lint"
npx eslint --no-eslintrc --env browser,es2017 --parser-options=ecmaVersion:2020 --global katex,claude,MathfieldElement \
  --rule '{"no-undef":2,"no-unused-vars":[1,{"args":"none"}],"no-redeclare":2,"no-dupe-keys":2,"no-unreachable":2}' "$TMP/page.js" && echo "clean"
echo "== formatting"
npx prettier --config ../../.prettierrc.json --check "$WEB/scripts/*.js" "$WEB/styles/*.css" 2>&1 | tail -1
echo "== invisible characters (write them as \\u escapes)"
python3 - "$WEB/scripts" <<'PY'
import glob, sys
INVISIBLE = {0x01, 0xa0, 0x2002, 0x2003, 0x2009, 0x200b, 0x200c, 0x200d, 0x202f, 0x2060, 0x3000, 0xfeff}
found = 0
for path in sorted(glob.glob(sys.argv[1] + '/*.js')):
    for number, line in enumerate(open(path, encoding='utf8'), 1):
        codes = sorted({'U+%04X' % ord(c) for c in line if ord(c) in INVISIBLE})
        if codes:
            found += 1
            print('%s:%d %s' % (path.split('/')[-1], number, ' '.join(codes)))
print('none' if not found else '%d line(s)' % found)
PY
echo "== long functions"
node fnlen.js "$WEB/scripts" 20 15
if [ "${1:-}" = "--print" ]; then npx esbuild "$TMP/page.js" --minify --log-level=error > /tmp/apatite-page.min.js && echo "minified script: /tmp/apatite-page.min.js"; fi
rm -rf "$TMP"
