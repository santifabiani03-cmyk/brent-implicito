"""Genera web/index.html (sitio con data.json externo) y dist/preview.html (un solo archivo con datos embebidos)."""
from .common import RAIZ

def main():
    w = RAIZ / "web"
    page = (w / "_page.html").read_text(encoding="utf-8")
    eng, app = (w / "engine.js").read_text(encoding="utf-8"), (w / "app.js").read_text(encoding="utf-8")
    base = page.replace("/*__ENGINE__*/", eng).replace("/*__APP__*/", app)
    (w / "index.html").write_text('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'
                                  + base.replace("/*__DATA__*/", "") + "</body></html>", encoding="utf-8")
    data = (w / "data.json").read_text(encoding="utf-8").replace("</", "<\\/")
    (RAIZ / "dist").mkdir(exist_ok=True)
    (RAIZ / "dist" / "preview.html").write_text(base.replace("/*__DATA__*/", data), encoding="utf-8")
    cab = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'
    (RAIZ / "ABRIR PAGINA - Barril Implicito.html").write_text(cab + base.replace("/*__DATA__*/", data) + "</body></html>", encoding="utf-8")
    print("empaquetado: web/index.html, dist/preview.html, 'ABRIR PAGINA - Barril Implicito.html'")

if __name__ == "__main__":
    main()
