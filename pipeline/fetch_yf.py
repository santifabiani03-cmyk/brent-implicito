"""Estados financieros trimestrales vía yfinance (Yahoo) para las 6 empresas.
Toma los últimos 4 trimestres (TTM) de: capex, DD&A, costo de ventas, impuesto y resultado antes de impuestos,
y el último balance: deuda total, caja, acciones, minoritarios.
⚠️ Yahoo no siempre informa bien la moneda: se usa `moneda_estados_yf` de config (BRL → USD con PTAX actual)."""
import math
from .common import guardar, cargar, ahora_iso, companias

FILAS = {
    "capex": ["Capital Expenditure"],
    "dda": ["Depreciation Amortization Depletion", "Depreciation And Amortization", "Reconciled Depreciation"],
    "costo_ventas": ["Cost Of Revenue"],
    "impuesto": ["Tax Provision"],
    "antes_imp": ["Pretax Income"],
    "ingresos": ["Total Revenue"],
    "sga": ["Selling General And Administration", "General And Administrative Expense"],
    "intereses": ["Interest Expense", "Interest Expense Non Operating"],
    "deuda": ["Total Debt"],
    "caja": ["Cash And Cash Equivalents"],
    "inv_cp": ["Other Short Term Investments"],
    "acciones": ["Ordinary Shares Number", "Share Issued"],
    "minoritarios": ["Minority Interest"],
}


def _fila(df, nombres, n=None):
    for nm in nombres:
        if nm in df.index:
            s = [float(x) for x in df.loc[nm].tolist() if x is not None and not (isinstance(x, float) and math.isnan(x))]
            if s:
                return s[:n] if n else s[0]
    return None


def extraer(ticker: str) -> dict:
    import yfinance as yf
    tk = yf.Ticker(ticker)
    cf, inc, bs = tk.quarterly_cashflow, tk.quarterly_income_stmt, tk.quarterly_balance_sheet
    ttm = lambda df, k: (lambda s: sum(s) if s and len(s) == 4 else None)(_fila(df, FILAS[k], 4))
    try:
        info = tk.info
    except Exception:  # noqa: BLE001
        info = {}
    return {
        "shares_info": info.get("sharesOutstanding"), "mcap_info": info.get("marketCap"),
        "cierre": str(bs.columns[0].date()) if len(bs.columns) else None,
        "capex_ttm": ttm(cf, "capex"), "dda_ttm": ttm(cf, "dda") or ttm(inc, "dda"),
        "costo_ventas_ttm": ttm(inc, "costo_ventas"), "impuesto_ttm": ttm(inc, "impuesto"),
        "antes_imp_ttm": ttm(inc, "antes_imp"), "ingresos_ttm": ttm(inc, "ingresos"),
        "sga_ttm": ttm(inc, "sga"), "intereses_ttm": ttm(inc, "intereses"),
        "deuda": _fila(bs, FILAS["deuda"]), "caja": _fila(bs, FILAS["caja"]), "inv_cp": _fila(bs, FILAS["inv_cp"]),
        "acciones": _fila(bs, FILAS["acciones"]), "minoritarios": _fila(bs, FILAS["minoritarios"]),
    }


def main():
    fx = (cargar("fx.json") or {}).get("usd_brl")
    out = {"actualizado": ahora_iso(), "empresas": {}, "errores": {}}
    for c in companias():
        try:
            d = extraer(c["ticker_yf_fund"])
            div = fx if c["moneda_estados_yf"] == "BRL" else 1.0
            m = lambda v: None if v is None else v / div / 1e6          # → MUSD
            tasa = None
            if d["impuesto_ttm"] is not None and d["antes_imp_ttm"]:
                tasa = min(max(d["impuesto_ttm"] / d["antes_imp_ttm"], 0.0), 0.6)
            out["empresas"][c["id"]] = {
                "cierre": d["cierre"], "capex_musd_ttm": m(abs(d["capex_ttm"])) if d["capex_ttm"] else None,
                "dda_musd_ttm": m(d["dda_ttm"]), "costo_ventas_musd_ttm": m(d["costo_ventas_ttm"]),
                "ingresos_musd_ttm": m(d["ingresos_ttm"]), "tasa_impuesto_efectiva": tasa,
                "sga_musd_ttm": m(d["sga_ttm"]), "intereses_musd_ttm": m(abs(d["intereses_ttm"])) if d["intereses_ttm"] else None,
                "deuda_musd": m(d["deuda"]), "caja_musd": m((d["caja"] or 0) + (d["inv_cp"] or 0)),
                "deuda_neta_musd": m((d["deuda"] or 0) - (d["caja"] or 0) - (d["inv_cp"] or 0)) if d["deuda"] is not None else None,
                "acciones_mm": (d["shares_info"] or d["acciones"] or 0) / 1e6 or None,
                "mcap_yahoo_musd": d["mcap_info"] / 1e6 if d["mcap_info"] else None, "minoritarios_musd": m(d["minoritarios"]) or 0.0,
                "moneda_origen": c["moneda_estados_yf"], "moneda_verificar": c["moneda_estados_verificar"],
                "fuente": f"Yahoo Finance vía yfinance ({c['ticker_yf_fund']}), últimos 4 trimestres al {d['cierre']}"
                          + (f"; BRL→USD con PTAX {fx}" if div != 1 else "")}
            e = out["empresas"][c["id"]]
            print("yf:", c["id"], e["cierre"], "capex TTM", round(e["capex_musd_ttm"] or 0), "DDA TTM", round(e["dda_musd_ttm"] or 0), "tasa", e["tasa_impuesto_efectiva"] and round(e["tasa_impuesto_efectiva"], 3))
        except Exception as ex:  # noqa: BLE001
            out["errores"][c["id"]] = str(ex)
    guardar("fund_yf.json", out)


if __name__ == "__main__":
    main()
