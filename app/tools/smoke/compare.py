"""Compares two smoke reports, optionally leaving out some steps (ones only one of them ran).
Usage: python3 app/tools/smoke/compare.py old new [step to skip …]"""
import json
import sys

here = __file__.rsplit('/', 1)[0] + '/reports/'
old, new = (json.load(open(here + name + '.json', encoding='utf8')) for name in sys.argv[1:3])
skip = set(sys.argv[3:])
differences = 0
for step in sorted(set(old) | set(new)):
    if step in skip:
        continue
    if old.get(step) != new.get(step):
        differences += 1
        print('== ' + step)
        print('old:', json.dumps(old.get(step), ensure_ascii=False)[:1500])
        print('new:', json.dumps(new.get(step), ensure_ascii=False)[:1500])
print('SAME' if not differences else '%d step(s) differ' % differences)
sys.exit(1 if differences else 0)
