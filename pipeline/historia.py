"""Serie histórica del Brent implícito, día por día.

Idea (ALCANCE §7): cada balance trimestral "configura" el modelo de la empresa; entre balances, lo único que se mueve
es la capitalización bursátil. Para cada día d:
    calibración vigente = último balance con fecha de PUBLICACIÓN ≤ d   (sin look-ahead)
    capitalización(d)   = precio(d) × acciones de esa calibración (÷ ratio ADR, ÷ USD/BRL para PRIO)
    Brent implícito(d)  = despeje del motor con esa calibración y esa capitalización

Uso:
    python -m pipeline.historia                    # desde 1T2024 (cubre la ventana 3T2024–1T2026)
    python -m pipeline.historia --desde 2021-12-31 # agrega la muestra de control 2022–2023
Los documentos de EDGAR ya leídos quedan en data/historia/ y no se vuelven a bajar."""
import csv, io, json, sys, math, datetime as dt
from .common import RAIZ, get, guardar, ahora_iso, companias, cargar
from .fetch_edgar import extraer_periodo
from .fetch_macro import damodaran, argentina
from .derivar import derivar
from engine import model

HIST = RAIZ / "data" / "historia"
HIST.mkdir(parents=True, exist_ok=True)
FINES = ("03-31", "06-30", "09-30", "12-31")
HDR = {"User-Agent": "Mozilla/5.0"}


def trimestres(desde: str) -> list[str]:
    d0, hoy, out = dt.date.fromisoformat(desde), dt.date.today(), []
    for y in range(d0.year, hoy.year + 1):
        for f in FINES:
            q = f"{y}-{f}"
            if desde <= q and dt.date.fromisoformat(q) < hoy:
                out.append(q)
    return out


# ------------------------------------------------------------------ series de mercado
def serie_yahoo(ticker: str, desde: str) -> dict:
    p1 = int(dt.datetime.fromisoformat(desde).timestamp())
    j = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}", headers=HDR,
            params={"period1": p1, "period2": int(dt.datetime.now().timestamp()), "interval": "1d"}).json()["chart"]["result"][0]
    out = {}
    for ts, c in zip(j["timestamp"], j["indicators"]["quote"][0]["close"]):
        if c is not None:
            out[dt.datetime.utcfromtimestamp(ts).date().isoformat()] = c
    return out


def serie_fred(sid: str) -> dict:
    filas = list(csv.reader(io.StringIO(get("https://fred.stlouisfed.org/graph/fredgraph.csv", params={"id": sid}).text)))[1:]
    return {f: float(v) for f, v in filas if v not in (".", "")}


def al_dia(serie: dict, d: str):
    """Último valor disponible ≤ d."""
    ks = [k for k in serie if k <= d]
    return serie[max(ks)] if ks else None


# ------------------------------------------------------------------ estados financieros por trimestre (yfinance)
def financieros(ticker: str) -> dict:
    import yfinance as yf
    tk = yf.Ticker(ticker)
    tablas = {"q": (tk.quarterly_cashflow, tk.quarterly_income_stmt, tk.quarterly_balance_sheet),
              "a": (tk.cashflow, tk.income_stmt, tk.balance_sheet)}
    out = {}
    for freq, (cf, inc, bs) in tablas.items():
        filas = {}
        for df in (cf, inc, bs):
            for nom in df.index:
                filas[nom] = {str(c.date()): (None if (v is None or (isinstance(v, float) and math.isnan(v))) else float(v))
                              for c, v in df.loc[nom].items()}
        out[freq] = filas
    return out


def _fila(tab, nombres):
    for n in nombres:
        if n in tab:
            return tab[n]
    return {}


def fin_trimestre(F: dict, q: str, moneda_div: float) -> dict:
    """TTM con 4 trimestres terminados en q; si yfinance no llega tan atrás, último ejercicio anual cerrado ≤ q."""
    qs = sorted({d for fila in F["q"].values() for d in fila if d <= q}, reverse=True)[:4]
    usa_q = len(qs) == 4 and qs[0] == q
    def flujo(noms):
        fila = _fila(F["q"] if usa_q else F["a"], noms)
        if usa_q:
            vals = [fila.get(d) for d in qs]
            if all(v is not None for v in vals):
                return sum(vals)
        fa = _fila(F["a"], noms)
        ks = [d for d in fa if d <= q and fa[d] is not None]
        return fa[max(ks)] if ks else None
    def stock(noms):
        for base in ("q", "a"):
            fila = _fila(F[base], noms)
            ks = [d for d in fila if d <= q and fila[d] is not None]
            if ks:
                return fila[max(ks)]
        return None
    m = lambda v: None if v is None else v / moneda_div / 1e6
    capex, dda = flujo(["Capital Expenditure"]), flujo(["Depreciation Amortization Depletion", "Depreciation And Amortization"])
    deuda, caja = stock(["Total Debt"]), stock(["Cash And Cash Equivalents"])
    return {"capex_musd_ttm": m(abs(capex)) if capex else None, "dda_musd_ttm": m(dda),
            "sga_musd_ttm": m(flujo(["Selling General And Administration", "General And Administrative Expense"])),
            "intereses_musd_ttm": m(abs(flujo(["Interest Expense", "Interest Expense Non Operating"]) or 0)) or None,
            "deuda_musd": m(deuda), "deuda_neta_musd": m((deuda or 0) - (caja or 0)) if deuda is not None else None,
            "acciones_bs": stock(["Ordinary Shares Number", "Share Issued"]), "minoritarios_musd": m(stock(["Minority Interest"])) or 0.0,
            "base": "TTM trimestral" if usa_q else "último ejercicio anual cerrado (yfinance no cubre 4 trimestres)",
            "fuente": f"Yahoo Finance vía yfinance ({'TTM al ' + q if usa_q else 'anual ≤ ' + q})"}


# ------------------------------------------------------------------ calibraciones
def trimestres_idx(q: str) -> int:
    return int(q[:4]) * 4 + FINES.index(q[5:]) 
def calibrar(c, q, ed, fin, macro_q, spot, precio_pub, fx_pub, sem_pub, memoria, acciones_ref):
    ins = {}
    acc = acciones_ref(fin, c)
    cap = None
    if precio_pub and acc:
        cap = precio_pub * acc / c["ratio_adr_acciones"] / (fx_pub if c["moneda_cotizacion"] == "BRL" else 1)
    y = {**fin, "deuda_musd": fin.get("deuda_musd")}
    der = derivar(c, ed, y, macro_q, spot, cap, sem_pub, None)
    ins.update({k: v for k, v in der.items()})
    for k, v in (("capex_musd_anual", fin.get("capex_musd_ttm")), ("deuda_neta_musd", fin.get("deuda_neta_musd")),
                 ("minoritarios_musd", fin.get("minoritarios_musd"))):
        if v is not None:
            ins[k] = {"valor": v, "origen": "automatico", "fuente": fin["fuente"], "nota": fin["base"]}
    if "reservas_mmboe" in (ed.get("valores") or {}):
        ins["reservas_1p_mmboe"] = {"valor": ed["valores"]["reservas_mmboe"]["valor"], "origen": "edgar", "nota": "Reservas probadas del reporte anual"}
    for k, v in sem_pub.items():
        ins.setdefault(k, v)
    arrastrados = []
    edad_max = lambda k: 4 if k == "reservas_1p_mmboe" else 2      # trimestres: reservas son anuales
    iq = trimestres_idx(q)
    for k in model.CAMPOS_REQUERIDOS:
        if k not in ins and k in memoria and iq - memoria[k][1] <= edad_max(k):
            ins[k] = {**memoria[k][0], "origen": "arrastrado", "nota": f"Sin dato en {q}: se mantiene el publicado para {memoria[k][2]}"}
            arrastrados.append(k)
    for k, v in ins.items():
        if v.get("origen") != "arrastrado":
            memoria[k] = (v, iq, q)
    faltan = [k for k in model.CAMPOS_REQUERIDOS if k not in ins]
    return {"inputs": ins, "acciones_mm": acc, "arrastrados": arrastrados, "faltan": faltan}


def main(desde: str = "2023-12-31"):
    emps = companias()
    Q = trimestres(desde)
    inicio_px = (dt.date.fromisoformat(desde) - dt.timedelta(days=10)).isoformat()
    print(f"historia: {len(Q)} trimestres {Q[0]} → {Q[-1]}")
    # --- mercado
    px = {c["id"]: serie_yahoo(c["ticker_precio"], inicio_px) for c in emps}
    px["PBR_PREF"] = serie_yahoo("PBR-A", inicio_px)
    fx = serie_yahoo("BRL=X", inicio_px)
    brent_1l = serie_yahoo("BZ=F", inicio_px)
    spot = serie_fred("DCOILBRENTEU")
    rf = serie_fred("DGS10")
    ar = argentina()
    damo = {}
    def damo_para(fecha):
        anio = int(fecha[:4])
        suf = "" if anio >= dt.date.today().year else f"{(anio - 1) % 100:02d}"
        if suf not in damo:
            try:
                damo[suf] = damodaran(suf)
            except Exception:  # noqa: BLE001
                damo[suf] = damodaran("")
        return damo[suf]
    semillas = {}
    with (RAIZ / "inputs" / "semillas.csv").open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            semillas.setdefault(r["empresa"], []).append(r)
    cvm = cargar("fund_cvm.json", {}).get("empresas", {})

    def acciones_ref(fin, c):
        if c["id"] == "YPF":
            return 393.312793      # SEC dei:EntityCommonStockSharesOutstanding (20-F 2023–2025, constante)
        if c["id"] == "PBR":
            return cvm.get("PBR", {}).get("acciones_mm") or 12888.732761
        a = fin.get("acciones_bs")
        return a / 1e6 if a else None

    calib, spot_l = {}, sorted(spot.items())
    for c in emps:
        cache = HIST / f"fin_{c['id']}.json"
        try:
            F = financieros(c["ticker_precio"]); cache.write_text(json.dumps(F))
        except Exception:  # noqa: BLE001
            F = json.loads(cache.read_text()) if cache.exists() else {"q": {}, "a": {}}
        lista, memoria = [], {}
        for q in Q:
            # --- EDGAR (con caché)
            ed = {}
            if c.get("sec_cik") and c["id"] != "PRIO":
                f_ed = HIST / f"edgar_{c['id']}_{q}.json"
                if f_ed.exists():
                    ed = json.loads(f_ed.read_text())
                else:
                    ed = extraer_periodo(c["id"], c["sec_cik"], q)
                    if ed["docs"]:
                        f_ed.write_text(json.dumps(ed))
            fechas = [d["fecha"] for d in (ed.get("docs") or {}).values()]
            sem_q = {r["variable"]: {"valor": float(r["valor"]), "origen": "semilla", "fuente": r["fuente_url"],
                                     "nota": r["pagina_o_tabla"], "trimestre": r["trimestre"], "fecha_publicacion": r["fecha_publicacion"]}
                     for r in semillas.get(c["id"], []) if r["fecha_publicacion"] <= (max(fechas) if fechas else "9999")}
            if not fechas:
                if c["id"] == "PRIO" and sem_q:        # PRIO: solo trimestres con release citado
                    fechas = [max(v["fecha_publicacion"] for v in sem_q.values())]
                    if q != Q[-1]:
                        continue
                else:
                    continue
            pub = max(fechas)
            fin = fin_trimestre(F, q, (al_dia(fx, pub) if c["moneda_estados_yf"] == "BRL" else 1.0))
            d = damo_para(pub)
            macro_q = {"rf": {"valor": al_dia(rf, pub) / 100, "fecha": pub, "fuente": "FRED DGS10"}, "damodaran": d, "argentina": ar}
            cal = calibrar(c, q, ed, fin, macro_q, spot_l, al_dia(px[c["id"]], pub), al_dia(fx, pub), sem_q, memoria, acciones_ref)
            cal.update({"periodo": q, "publicado": pub, "docs": {k: v["url"] for k, v in (ed.get("docs") or {}).items()},
                        "fallas": ed.get("fallas", [])})
            lista.append(cal)
            print(f"  {c['id']} {q} publicado {pub}: {'completa' if not cal['faltan'] else 'faltan ' + ', '.join(cal['faltan'])}"
                  + (f" · arrastrados: {', '.join(cal['arrastrados'])}" if cal["arrastrados"] else ""), flush=True)
        calib[c["id"]] = lista

    # --- serie diaria
    dias = sorted(d for d in px["EOG"] if d >= Q[1])
    series = {}
    for c in emps:
        cals = [k for k in calib[c["id"]] if not k["faltan"]]
        out = {"fecha": [], "implicito": [], "banda_min": [], "banda_max": [], "cap_musd": [], "calibracion": []}
        cache_i = {}
        for d in dias:
            vig = [k for k in cals if k["publicado"] <= d]
            p = px[c["id"]].get(d)
            if not vig or p is None:
                continue
            k = vig[-1]
            acc = k["acciones_mm"]
            if c["id"] == "PBR" and px["PBR_PREF"].get(d):
                on, pn = cvm.get("PBR", {}).get("on_mm", 7442.231382), cvm.get("PBR", {}).get("pn_mm", 5446.501379)
                cap = (on * p + pn * px["PBR_PREF"][d]) / c["ratio_adr_acciones"]
            elif c["moneda_cotizacion"] == "BRL":
                f = al_dia(fx, d)
                cap = p * acc / f if f else None
            else:
                cap = p * acc / c["ratio_adr_acciones"]
            if not cap:
                continue
            if k["periodo"] not in cache_i:
                cache_i[k["periodo"]] = model.Inputs.desde_dict({kk: v["valor"] for kk, v in k["inputs"].items()})
            i = cache_i[k["periodo"]]
            bi = model.brent_implicito(i, cap)
            bd = model.banda(i, cap)
            out["fecha"].append(d); out["implicito"].append(bi["valor"]); out["cap_musd"].append(round(cap, 1))
            out["banda_min"].append(bd["min"]); out["banda_max"].append(bd["max"]); out["calibracion"].append(k["periodo"])
        series[c["id"]] = out
        print(f"serie: {c['id']} {len(out['fecha'])} días" + (f", {out['fecha'][0]} → {out['fecha'][-1]}" if out["fecha"] else ""))

    rng = lambda s: {"fecha": [d for d in sorted(s) if d >= Q[1]], "valor": [round(s[d], 2) for d in sorted(s) if d >= Q[1]]}
    resultado = {"actualizado": ahora_iso(), "desde": Q[0], "series": series, "brent_spot": rng(spot), "brent_1l": rng(brent_1l),
                 "calibraciones": {e: [{"periodo": k["periodo"], "publicado": k["publicado"], "docs": k["docs"], "fallas": k["fallas"],
                                        "faltan": k["faltan"], "arrastrados": k["arrastrados"], "acciones_mm": k["acciones_mm"],
                                        "inputs": {kk: {"valor": v["valor"], "origen": v["origen"]} for kk, v in k["inputs"].items()}}
                                       for k in ls] for e, ls in calib.items()}}
    guardar("serie.json", resultado)
    return resultado


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--desde") + 1] if "--desde" in sys.argv else "2023-12-31")
