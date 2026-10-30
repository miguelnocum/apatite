"""Compares two smoke reports, optionally leaving out some steps (ones only one of them ran).
Usage: python3 app/tools/smoke/compare.py old new [step to skip …]
A name is a report in app/tools/smoke/reports/, or a path (anything with a / in it), e.g. baseline/native.json.
Browser noise that comes and goes with timing (ResizeObserver loop warnings) is left out of `errors`, and counted."""
import json
import os
import sys

here = __file__.rsplit('/', 1)[0] + '/'
NOISE = 'ResizeObserver loop'


def load(name):
    path = (name if os.path.exists(name) else here + name) if '/' in name else here + 'reports/' + name + '.json'
    report = json.load(open(path, encoding='utf8'))
    errors = report.get('errors')
    if isinstance(errors, list):
        report['errors'] = [e for e in errors if NOISE not in e]
        print('%s: %d error(s), %d %s warning(s) left out' % (name, len(report['errors']), len(errors) - len(report['errors']), NOISE))
    return report


old, new = load(sys.argv[1]), load(sys.argv[2])
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
