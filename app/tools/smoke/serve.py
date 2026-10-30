"""Serves the project root for the page smoke test and saves its reports.

Usage: python3 app/tools/smoke/serve.py   (from ~/Apatite; port 8766)
Then open http://localhost:8766/app/Resources/notebook.html and run the test (see page-smoke.js); it posts its report
to /smoke-report/<name>, saved as app/tools/smoke/reports/<name>.json, to compare with diff.
"""
import http.server
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
REPORTS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'reports')
PORT = 8766


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

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
