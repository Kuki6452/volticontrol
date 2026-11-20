"""Genera dist/volticontrol.html: una sola página con CSS y JS incrustados."""
import re, pathlib
raiz = pathlib.Path(__file__).parent
html = (raiz / 'index.html').read_text(encoding='utf-8')
css = (raiz / 'css/styles.css').read_text(encoding='utf-8')
html = html.replace('<link rel="stylesheet" href="css/styles.css">', '<style>\n' + css + '\n</style>')
# El archivo suelto no se instala como app: sin manifiesto ni ícono externo
# (así tampoco registra el modo sin internet, que solo funciona publicado).
html = re.sub(r'<link rel="(manifest|apple-touch-icon)"[^>]*>\n?', '', html)
for js in ['calculos', 'datos', 'app']:
    codigo = (raiz / f'js/{js}.js').read_text(encoding='utf-8')
    html = html.replace(f'<script src="js/{js}.js"></script>', '<script>\n' + codigo + '\n</script>')
(raiz / 'dist').mkdir(exist_ok=True)
(raiz / 'dist/volticontrol.html').write_text(html, encoding='utf-8')
# versión para el artifact: sin doctype/html/head/body (el visor los agrega)
cuerpo = re.sub(r'<!doctype html>\s*<html[^>]*>\s*<head>\s*', '', html, flags=re.I)
cuerpo = re.sub(r'<meta charset="utf-8">\s*<meta name="viewport"[^>]*>\s*', '', cuerpo)
cuerpo = cuerpo.replace('</head>\n<body>\n', '').replace('</body>\n</html>\n', '')
(raiz / 'dist/artifact.html').write_text(cuerpo, encoding='utf-8')
print('ok', len(html))