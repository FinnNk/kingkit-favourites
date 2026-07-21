# Serves the repository for the test harness with correct MIME types.
# Windows' registry-driven mimetypes can serve .mjs as text/plain, which
# breaks ES module imports (the semantic layer's WASM loader is an .mjs).
#
#   python tools/serve.py [port]     # default 8000, from the repo root
import http.server
import sys

class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        '.js': 'text/javascript',
        '.mjs': 'text/javascript',
        '.wasm': 'application/wasm',
        '.json': 'application/json',
    }

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    http.server.ThreadingHTTPServer(('127.0.0.1', port), Handler).serve_forever()
