"""Riesgo país diario (TIF 7.4 y 8.2): diferencial soberano de cada fecha, en decimales.
Argentina: EMBI publicado por ArgentinaDatos (el CDS de Bloomberg CT350188 trae saltos entre dos niveles y un hueco de 154 días).
Brasil: CDS soberano a 5 años de Bloomberg (inputs/bloomberg/cds.csv). Mercados desarrollados: 0.
Cada fecha toma el último dato disponible. Si la API falla, sigue con la copia guardada en data/riesgo_pais.json."""
import csv
from .common import RAIZ, get, guardar, ahora_iso, cargar

URL_AR = "https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais"
FUENTES = {"Argentina": "EMBI, ArgentinaDatos (api.argentinadatos.com)", "Brasil": "CDS soberano 5 años, Bloomberg (CBRZ1U5 CBIN Curncy)"}
TICKER_BR = "CBRZ1U5 CBIN Curncy"


def series() -> dict:
    """{'Argentina': {fecha: decimal}, 'Brasil': {fecha: decimal}}."""
    try:
        ar = {x["fecha"]: float(x["valor"]) / 1e4 for x in get(URL_AR).json()}
        guardar("riesgo_pais.json", {"actualizado": ahora_iso(), "fuente": FUENTES["Argentina"], "Argentina": ar})
    except Exception:  # noqa: BLE001
        ar = cargar("riesgo_pais.json", {}).get("Argentina", {})
    br = {}
    with (RAIZ / "inputs" / "bloomberg" / "cds.csv").open(encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            if r["ticker_bloomberg"] == TICKER_BR:
                br[r["fecha"]] = float(r["cds_5y_pb"]) / 1e4
    return {"Argentina": ar, "Brasil": br}


def al_dia(serie: dict, region: str, fecha: str) -> float | None:
    """Diferencial vigente en la fecha: último dato ≤ fecha. Regiones sin serie (mercados desarrollados): 0, como dice 8.2."""
    if region not in serie:
        return 0.0
    ks = [k for k in serie[region] if k <= fecha]
    return serie[region][max(ks)] if ks else None
