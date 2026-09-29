"""Punto de entrada único (lo corre GitHub Actions). Si una fuente falla, se sigue con el último dato guardado."""
import traceback
from . import fetch_market, fetch_brent, fetch_fx, fetch_sec, fetch_cvm, fetch_yf, fetch_ar, fetch_macro, fetch_edgar, historia, build

for paso in (fetch_market, fetch_brent, fetch_fx, fetch_sec, fetch_cvm, fetch_yf, fetch_ar, fetch_macro, fetch_edgar, historia):
    try:
        paso.main()
    except Exception:  # noqa: BLE001
        print(f"⚠️ {paso.__name__} falló; se usa el último dato guardado"); traceback.print_exc()
build.main()
from . import empaquetar
empaquetar.main()
