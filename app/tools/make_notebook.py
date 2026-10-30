"""Builds the notebook page from its sources in ../web.

web/ holds the page in parts, each a file of its own:
  head.html          the links in the page's head (KaTeX, MathLive, fonts)
  styles/*.css       the styles, in the order listed in styles/order.txt (the order matters: later rules win)
  body.html          the markup
  scripts/**/*.js    the script, in feature folders, in the order listed in scripts/order.txt; they share one scope, so a
                     function in one file can be used in any other (top-level code runs in the listed order)

An order.txt lists one path per line, relative to its folder; blank lines and lines starting with # are ignored. The build
stops with an error if a listed file is missing, if a file is listed twice, or if a file on disk is not listed.

The parts are joined into the whole page (the web version, which works as a web artifact too and switches to the Mac
app's local files when it finds the app's "nb" message handler), and that is wrapped in a document for the app.

Usage: python3 tools/make_notebook.py ../web Resources/notebook.html [../apatite.html]
       (the optional third path also writes the page on its own, as the web version)
"""
import os
import sys


def read(path):
    with open(path, encoding='utf8') as f:
        return f.read()


def manifest(folder, ext):
    """The paths listed in folder/order.txt, in order. Stops with an error unless they match the files on disk exactly."""
    listed = []
    for line in read(os.path.join(folder, 'order.txt')).splitlines():
        line = line.strip()
        if line and not line.startswith('#'):
            listed.append(line)
    problems = ['listed twice: ' + n for n in sorted({n for n in listed if listed.count(n) > 1})]
    problems += ['listed but missing: ' + n for n in listed if not os.path.isfile(os.path.join(folder, n))]
    on_disk = set()
    for root, _, files in os.walk(folder):
        for n in files:
            if n.endswith(ext):
                on_disk.add(os.path.relpath(os.path.join(root, n), folder).replace(os.sep, '/'))
    problems += ['on disk but not listed: ' + n for n in sorted(on_disk - set(listed))]
    if problems:
        sys.exit('make_notebook: %s does not match %s:\n  %s' % (os.path.join(folder, 'order.txt'), folder, '\n  '.join(problems)))
    return listed


def parts(folder, ext):
    """The files of one kind in a folder, joined in the order its order.txt lists them."""
    return ''.join(read(os.path.join(folder, n)) for n in manifest(folder, ext))


def page(web):
    """The whole page: head links, styles, markup, then the script in one scope."""
    return (read(os.path.join(web, 'head.html'))
            + '<style>\n' + parts(os.path.join(web, 'styles'), '.css') + '</style>\n'
            + read(os.path.join(web, 'body.html'))
            + '<script>\n(function(){\n' + parts(os.path.join(web, 'scripts'), '.js') + '})();\n</script>\n')


def document(body):
    """The page wrapped in a document, for the app."""
    head = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1">\n</head>\n<body>\n')
    return head + body.strip() + '\n</body>\n</html>\n'


def write(path, text):
    with open(path, 'w', encoding='utf8') as f:
        f.write(text)
    print('wrote', path)


if __name__ == '__main__':
    web, dst = sys.argv[1], sys.argv[2]
    whole = page(web)
    write(dst, document(whole))
    if len(sys.argv) > 3:
        write(sys.argv[3], whole)
