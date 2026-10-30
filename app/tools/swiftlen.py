"""Lists Swift functions (and SwiftUI view bodies) longer than a limit.
Usage: python3 tools/swiftlen.py Sources/Apatite [limit=20] [count=40]
A function's length is its lines from the declaration to its closing brace. Strings (also multi-line ones) and
comments are skipped when matching braces."""
import glob
import re
import sys

DECLARATION = re.compile(r'^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:private|fileprivate|public|internal|static|final|override|'
                         r'mutating|nonisolated|@MainActor)\s+)*(?:func\s+(\w+)|(init)\??\s*[(<]|var\s+(\w+)\s*:\s*some\s+\w+)')


def code_only(text):
    """the source with strings and comments blanked (newlines kept), so braces can be counted"""
    out, i, n = [], 0, len(text)
    while i < n:
        if text.startswith('"""', i):
            end = text.find('"""', i + 3)
            end = n if end < 0 else end + 3
            out.append(re.sub(r'[^\n]', ' ', text[i:end]))
            i = end
        elif text[i] == '"':
            j = i + 1
            while j < n and text[j] != '"' and text[j] != '\n':
                j += 2 if text[j] == '\\' else 1
            out.append(' ' * (j + 1 - i))
            i = j + 1
        elif text.startswith('//', i):
            j = text.find('\n', i)
            j = n if j < 0 else j
            out.append(' ' * (j - i))
            i = j
        elif text.startswith('/*', i):
            j = text.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append(re.sub(r'[^\n]', ' ', text[i:j]))
            i = j
        else:
            out.append(text[i])
            i += 1
    return ''.join(out)


def functions(path):
    code = code_only(open(path, encoding='utf8').read())
    lines = code.split('\n')
    offsets = [0]
    for line in lines:
        offsets.append(offsets[-1] + len(line) + 1)
    for number, line in enumerate(lines):
        match = DECLARATION.match(line)
        if not match:
            continue
        name = match.group(1) or match.group(2) or match.group(3)
        start = code.find('{', offsets[number])
        if start < 0:
            continue
        # a protocol requirement or a declaration without a body ends before its brace
        if '\n' in code[offsets[number]:start] and code[offsets[number]:start].count('\n') > 6:
            continue
        depth, i = 0, start
        while i < len(code):
            if code[i] == '{':
                depth += 1
            elif code[i] == '}':
                depth -= 1
                if depth == 0:
                    break
            i += 1
        end_line = code.count('\n', 0, i)
        yield name, number + 1, end_line - number + 1


def main():
    root = sys.argv[1] if len(sys.argv) > 1 else 'Sources/Apatite'
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20
    count = int(sys.argv[3]) if len(sys.argv) > 3 else 40
    found = []
    total = 0
    for path in sorted(glob.glob(root + '/**/*.swift', recursive=True)):
        for name, line, length in functions(path):
            total += 1
            if length > limit:
                found.append((length, path.split('/')[-1], line, name))
    found.sort(reverse=True)
    print('functions %d over %d lines: %d' % (total, limit, len(found)))
    for length, path, line, name in found[:count]:
        print('%4d  %s:%d  %s' % (length, path, line, name))


main()
