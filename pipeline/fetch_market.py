"""Cotizaciones diarias (Yahoo Finance chart API, sin key).
⚠️ Fuente no institucional: sirve para la web en vivo. El backtest del TIF usa la serie de
Bloomberg/FinLab (requisito del Reglamento), exportada a data/bloomberg/*.csv."""
from .common import get, guardar, ahora_iso, companias

URL = "https://query1.finance.yahoo.com/v8/finance/chart/{t}"
HDR = {"User-Agent": "Mozilla/5.0"}


def cotizacion(ticker: str, rango: str = "1y") -> dict:
    j = get(URL.format(t=ticker), params={"range": rango, "interval": "1d"}, headers=HDR).json()
    r = j["chart"]["result"][0]
    m = r["meta"]
    closes = r["indicators"]["quote"][0]["close"]
    serie = [[ts, c] for ts, c in zip(r["timestamp"], closes) if c is not None]
    return {"ticker": ticker, "moneda": m.get("currency"), "precio": m.get("regularMarketPrice"),
            "ts": m.get("regularMarketTime"), "serie_1y": serie,
            "fuente": f"Yahoo Finance chart API ({ticker})"}


def main():
    out = {"actualizado": ahora_iso(), "cotizaciones": {}, "errores": {}}
    for c in companias():
        try:
            out["cotizaciones"][c["id"]] = cotizacion(c["ticker_precio"])
            if c.get("ticker_precio_pref"):
                out["cotizaciones"][c["id"] + "_PREF"] = cotizacion(c["ticker_precio_pref"])
        except Exception as e:  # noqa: BLE001
            out["errores"][c["id"]] = str(e)
    guardar("mercado.json", out)
    print(f"mercado: {len(out['cotizaciones'])} ok, {len(out['errores'])} errores")


if __name__ == "__main__":
    main()
