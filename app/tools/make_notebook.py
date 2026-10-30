"""Builds the notebook page from its sources in ../web.

web/ holds the page in parts, each a file of its own:
  head.html          the links in the page's head (KaTeX, MathLive, fonts)
  styles/*.css       the styles, in file-name order (the order matters: later rules win)
  body.html          the markup
  scripts/*.js       the script, in file-name order; they share one scope, so a function in one file can be used in any other

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


def parts(folder, ext):
    """The files of one kind in a folder, joined in file-name order."""
    names = sorted(n for n in os.listdir(folder) if n.endswith(ext))
    return ''.join(read(os.path.join(folder, n)) for n in names)


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
