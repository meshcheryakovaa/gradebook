"""Build the offline release using assets in index.html order."""
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
version = sys.argv[1] if len(sys.argv) > 1 else '13.1'
if not re.fullmatch(r'\d+(?:\.\d+)*', version):
    raise SystemExit('Version must contain only numbers and dots')
html = (root / 'index.html').read_text(encoding='utf-8')
css_pattern = r'<link rel="stylesheet" href="(css/[^\"]+)">'
js_pattern = r'<script src="(js/[^\"]+)"></script>'
css_files = re.findall(css_pattern, html)
js_files = re.findall(js_pattern, html)
if not css_files or not js_files:
    raise SystemExit('No source assets found')
css = '\n\n'.join((root / p).read_text(encoding='utf-8') for p in css_files)
js = '\n\n'.join((root / p).read_text(encoding='utf-8') for p in js_files)
html = re.sub(css_pattern, lambda m: '<style>\n' + css + '\n</style>' if m.group(1) == css_files[0] else '', html)
html = re.sub(js_pattern, lambda m: '<script>\n' + js.replace('</script', r'<\/script') + '\n</script>' if m.group(1) == js_files[0] else '', html)
html = html.replace('<title>Журнал учебных занятий</title>', f'<title>Gradebook v{version} — Журнал учебных занятий</title>')
if re.search(r'<(?:script\b[^>]*src=|link\b[^>]*href=)', html):
    raise SystemExit('Standalone build still references external assets')
out = root / 'dist' / f'Gradebook-v{version}.html'
out.parent.mkdir(exist_ok=True)
out.write_text(html, encoding='utf-8')
print(f'{out.name}: {out.stat().st_size} bytes')
