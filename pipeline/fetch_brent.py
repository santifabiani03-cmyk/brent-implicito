"""Brent: spot (Dated, FRED/EIA DCOILBRENTEU) + primera línea y curva de futuros ICE (Yahoo).
⚠️ Decisión metodológica abierta: el TIF debe definir contra qué Brent se compara el implícito
(spot Dated vs. futuro de 1ª línea vs. curva). En sep-2026 la diferencia entre ambos es grande."""
import csv, io, datetime as dt
from .common import get, guardar, ahora_iso

MESES = "FGHJKMNQUVXZ"
HDR = {"User-Agent": "Mozilla/5.0"}


def spot_fred(n: int = 400) -> list:
    txt = get("https://fred.stlouisfed.org/graph/fredgraph.csv", params={"id": "DCOILBRENTEU"}).text
    filas = [r for r in csv.reader(io.StringIO(txt))][1:]
    return [[f, float(v)] for f, v in filas if v not in (".", "")][-n:]


def futuro(ticker: str):
    j = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}",
            params={"range": "5d", "interval": "1d"}, headers=HDR).json()
    res = j["chart"]["result"]
    if not res:
        return None
    m = res[0]["meta"]
    return {"ticker": ticker, "precio": m.get("regularMarketPrice"), "ts": m.get("regularMarketTime")}


def curva(meses: int = 24) -> list:
    hoy = dt.date.today()
    out = []
    for k in range(1, meses + 2):
        y, mth = hoy.year + (hoy.month - 1 + k) // 12, (hoy.month - 1 + k) % 12 + 1
        t = f"BZ{MESES[mth - 1]}{str(y)[2:]}.NYM"
        try:
            f = futuro(t)
            if f and f["precio"]:
                f["vencimiento"] = f"{y}-{mth:02d}"
                out.append(f)
        except Exception:  # noqa: BLE001
            pass
    return out


def main():
    out = {"actualizado": ahora_iso(), "fuentes": {
        "spot": "FRED DCOILBRENTEU (EIA, Europe Brent Spot Price FOB)",
        "futuros": "ICE Brent vía Yahoo Finance (BZ=F y contratos BZ<mes><año>.NYM)"}}
    out["spot"] = spot_fred()
    out["primera_linea"] = futuro("BZ=F")
    out["curva"] = curva()
    guardar("brent.json", out)
    print(f"brent: spot {out['spot'][-1]}, 1ª línea {out['primera_linea']['precio']}, curva {len(out['curva'])} contratos")


if __name__ == "__main__":
    main()
