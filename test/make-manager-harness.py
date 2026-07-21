# Regenerates test/manager-harness.html (gitignored) from src/manager.html,
# swapping in the chrome mock and seed data so the real manager UI can be
# exercised in a plain browser tab:
#
#   python test/make-manager-harness.py
#   python tools/serve.py 8000
#   -> open http://127.0.0.1:8000/test/manager-harness.html
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / 'src' / 'manager.html').read_text(encoding='utf-8')

html = html.replace('<link rel="stylesheet" href="manager.css">',
                    '<link rel="stylesheet" href="../src/manager.css">')
html = html.replace(
    '<script src="storage.js"></script>\n  <script src="scalemates.js"></script>\n  <script src="semantic.js"></script>\n  <script src="manager.js"></script>',
    '\n  '.join([
        '<script src="mock-chrome.js"></script>',
        '<script src="sm-fixtures.js"></script>',
        '<script src="../src/storage.js"></script>',
        '<script src="../src/scalemates.js"></script>',
        '<script src="../src/semantic.js"></script>',
        '<script src="seed-sem.js"></script>',
        '<script src="../src/manager.js"></script>',
    ]))
assert 'mock-chrome.js' in html, 'script block in src/manager.html changed; update this generator'

out = root / 'test' / 'manager-harness.html'
out.write_text(html, encoding='utf-8')
print('wrote', out)
