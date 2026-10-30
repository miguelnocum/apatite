"""Serves the project root for the page smoke test and saves its reports.

Usage: python3 app/tools/smoke/serve.py   (from ~/Apatite; port 8766)
Then open http://localhost:8766/app/Resources/notebook.html and run the test (see page-smoke.js); it posts its report
to /smoke-report/<name>, saved as app/tools/smoke/reports/<name>.json, to compare with diff.

http://localhost:8766/native/notebook.html is the same page as the Mac app runs it: the same file, with fake-bridge.js
and native-fixture.json (what the app injects before the page's scripts) put in front of it, so the page takes its
native path (Store from window.__NB__, saves posted to a recorder in window.__posted). Nothing in web/ differs.
"""
import http.server
import json
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
REPORTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reports')
PORT = 8766


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        path = self.path.split('?')[0]
        if not path.startswith('/native/'):
            return super().do_GET()
        page = os.path.join(ROOT, 'app', 'Resources', os.path.basename(path))
        if not os.path.isfile(page):
            return self.send_error(404)
        here = os.path.dirname(os.path.abspath(__file__))
        fixture = json.dumps(json.load(open(os.path.join(here, 'native-fixture.json'), encoding='utf8')))
        bridge = open(os.path.join(here, 'fake-bridge.js'), encoding='utf8').read()
        head = '<base href="/app/Resources/"><script>window.__FIXTURE__ = %s;\n%s</script>' % (fixture.replace('</', '<\\/'), bridge)
        html = open(page, encoding='utf8').read()
        at = html.index('<head>') + len('<head>')
        body = (html[:at] + head + html[at:]).encode('utf8')
        self.send_response(200)
        self.send_header('Content-Type', 'text/html; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        name = os.path.basename(self.path.rstrip('/')) or 'report'
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        os.makedirs(REPORTS, exist_ok=True)
        with open(os.path.join(REPORTS, name + '.json'), 'wb') as f:
            f.write(body)
        self.send_response(204)
        self.end_headers()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')   # always the page just built
        super().end_headers()

    def log_message(self, *args):
        pass


if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('localhost', PORT), Handler).serve_forever()
