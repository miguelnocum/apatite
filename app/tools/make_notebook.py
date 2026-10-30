"""Builds the notebook page from its sources in ../web.

web/ holds the page in parts, each a file of its own:
  head.html          the links in the page's head (KaTeX, MathLive, fonts)
  styles/*.css       the styles, in the order listed in styles/order.txt (the order matters: later rules win)
  body.html          the markup
  scripts/**/*.js    the script: ES modules in feature folders, with explicit imports and exports. scripts/app/start.js is
                     the entry: it calls each module's init function in the order that matters. They are bundled by
                     esbuild (tools/bundle.js, so building needs Node and `npm ci` in tools/) into one inline script

styles/order.txt lists the stylesheets, one path per line, relative to its folder; blank lines and lines starting with # are
ignored. The build stops with an error if a listed file is missing, if a file is listed twice, or if a file on disk is not
listed. (The scripts need no list: the bundler follows the imports from the entry, and stops on a file nothing imports.)

The parts are joined into the whole page (the web version, which works as a web artifact too and switches to the Mac
app's local files when it finds the app's "nb" message handler), and that is wrapped in a document for the app.

Usage: python3 tools/make_notebook.py ../web Resources/notebook.html [../apatite.html]
       (the optional third path also writes the page on its own, as the web version)
"""
import os
import shutil
import subprocess
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


def script(web):
    """The page's modules bundled into one script by esbuild (tools/bundle.js)."""
    tools = os.path.dirname(os.path.abspath(__file__))
    if not shutil.which('node'):
        sys.exit('make_notebook: Node is needed to bundle the page\'s scripts (install it, then run `npm ci` in %s)' % tools)
    if not os.path.isdir(os.path.join(tools, 'node_modules', 'esbuild')):
        sys.exit('make_notebook: esbuild is not installed: run `npm ci` in %s first' % tools)
    done = subprocess.run(['node', os.path.join(tools, 'bundle.js'), os.path.join(web, 'scripts')], capture_output=True, text=True)
    if done.returncode != 0:
        sys.exit('make_notebook: bundling the scripts failed:\n' + done.stderr)
    return done.stdout


def page(web):
    """The whole page: head links, styles, markup, then the bundled script."""
    return (read(os.path.join(web, 'head.html'))
            + '<style>\n' + parts(os.path.join(web, 'styles'), '.css') + '</style>\n'
            + read(os.path.join(web, 'body.html'))
            + '<script>\n' + script(web) + '</script>\n')


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
