"""Blanks what differs between runs in a regress report, so it can be compared with the saved baseline.
Usage: python3 regress-normalise.py <report> <library path>   (prints the normalised report)"""
import json
import re
import sys

report, library = sys.argv[1], sys.argv[2]
RULES = [
    (re.compile(r'\b(?:rm|pm|cm|es|fn|eq|k)(?=[a-z]*[0-9])[a-z0-9]{7,}\b'), '<id>'),
    # a random id can have no digits at all, so this one is known by where it stands
    (re.compile(r'^added source: \S+'), 'added source: <id>'),
    (re.compile(r'[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'), '<uuid>'),
    (re.compile(r'\b1[6-9][0-9]{11}\b'), '<time>'),
]
for line in open(report, encoding='utf8').read().split('\n'):
    line = line.replace(library, '<library>')
    # a JSON object at the end of a line comes out in no fixed key order
    brace = line.find('{"')
    if brace >= 0:
        try:
            line = line[:brace] + json.dumps(json.loads(line[brace:]), sort_keys=True, ensure_ascii=False, separators=(',', ':'))
        except ValueError:
            pass
    # the saved notebook is cut at a fixed length of JSON whose key order varies: keep up to the citation's end
    if line.startswith('saved notebook contains the citation:') and '<\\/span>' in line:
        line = line[: line.index('<\\/span>') + len('<\\/span>')]
    for pattern, blank in RULES:
        line = pattern.sub(blank, line)
    print(line)
