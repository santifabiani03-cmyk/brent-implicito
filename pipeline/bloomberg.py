"""Capa Bloomberg: estados contables y operativos de la terminal (UADE), cargados en inputs/bloomberg/<ID>.csv.

Prioridad: Bloomberg pisa a EDGAR y a yfinance en cada trimestre para las variables que trae; lo que no trae
lo completan EDGAR/yfinance como antes. Los montos en otra moneda se pasan a USD: flujos al tipo de cambio
promedio del trimestre, stocks al de cierre (Yahoo: BRL=X, CAD=X, ARS=X). Formato y variables: inputs/bloomberg/ESPEC.md."""
import csv, datetime as dt
from collections import defaultdict
from .common import RAIZ

DIR = RAIZ / "inputs" / "bloomberg"
FX_TICKER = {"BRL": "BRL=X", "CAD": "CAD=X", "ARS": "ARS=X"}
# variable Bloomberg → clave de EDGAR que entiende derivar() (montos del trimestre en MUSD)
A_EDGAR = {"ingresos_mm": "ingresos_musd", "dda_mm": "dda_musd", "sga_mm": "sga_musd", "opex_mm": "opex_musd",
           "toti_mm": "toti_musd", "retenciones_mm": "retenciones_musd", "ebitda_no_up_mm": "ebitda_no_up_q"}
FISICAS = ("crudo_kbd", "bitumen_kbd", "ngl_kbd", "gas_mmcfd", "total_kboed", "reservas_mmboe", "reservas_crudo_mmbbl")
PRECIOS = ("p_crudo", "p_ngl", "p_gas_mcf", "p_gas_mmbtu", "lifting_boe", "dda_boe")
FLUJOS = ("ingresos_mm", "dda_mm", "sga_mm", "opex_mm", "toti_mm", "regalias_mm", "retenciones_mm", "capex_mm",
          "intereses_mm", "impuesto_ganancias_mm", "resultado_antes_imp_mm", "ebitda_mm", "ebitda_no_up_mm")
STOCKS = ("deuda_mm", "caja_mm", "minoritarios_mm")
_fx_cache: dict = {}


# campos de Bloomberg que no corresponden a la definición del modelo (ver <ID>_notas.md):
# SU: "Operating, Selling & General" incluye costos operativos (duplicaría el lifting);
# EOG: "Cost of Goods & Services" incluye compras y comercialización (EDGAR trae el lifting por boe).
EXCLUIR = {"SU": {"sga_mm"}, "EOG": {"opex_mm"}, "PRIO": {"opex_mm"}}   # PRIO: COGS mezcla producción y regalías
# SU: el "opex" de Bloomberg es el OS&G total de Oil Sands + E&P (incluye G&A y transporte upstream)
REMAP = {"SU": {"opex_musd": "opex_upstream_total_musd"}}
# <ID>_operativos.csv (formato semillas, fuente pública citada) completa lo que el Excel de Bloomberg no trae
OPER = {"p_crudo_cad": ("p_crudo", "CAD"), "lifting_boe_cad": ("lifting_boe", "CAD"),
        "regalias_os_mm_cad": ("regalias_os_mm", "CAD"), "regalias_total_mm_cad": ("regalias_os_mm", "CAD"),
        "rm_resultado_antes_imp_mm_cad": ("rm_rai_mm", "CAD"), "rm_dda_mm_cad": ("rm_dda_mm", "CAD")}


def leer(emp: str) -> dict:
    """{periodo: {variable: fila}}: <ID>_operativos.csv (públicos) y encima <ID>.csv (Bloomberg)."""
    out = defaultdict(dict)
    po = DIR / f"{emp}_operativos.csv"
    if po.exists():
        with po.open(encoding="utf-8-sig") as fh:
            for r in csv.DictReader(fh):
                if r.get("valor") in (None, "") or not r.get("fuente_url"):
                    continue
                var, mon = OPER.get(r["variable"], (r["variable"], ""))
                out[r["trimestre"]][var] = {"empresa": emp, "periodo": r["trimestre"], "fecha_publicacion": r["fecha_publicacion"],
                                            "variable": var, "valor": float(r["valor"]), "unidad": r["unidad"], "moneda": mon,
                                            "fuente_url": r["fuente_url"], "campo_bloomberg": r.get("pagina_o_tabla")}
    p = DIR / f"{emp}.csv"
    if p.exists():
        with p.open(encoding="utf-8-sig") as fh:
            for r in csv.DictReader(fh):
                if r.get("valor") not in (None, "") and r["variable"] not in EXCLUIR.get(emp, ()):
                    out[r["periodo"]][r["variable"]] = {**r, "valor": float(r["valor"])}
    return dict(out)


def _fx(moneda: str):
    if moneda not in _fx_cache:
        from .historia import serie_yahoo
        try:
            _fx_cache[moneda] = serie_yahoo(FX_TICKER[moneda], "2023-01-01")
        except Exception:  # noqa: BLE001
            _fx_cache[moneda] = {}
    return _fx_cache[moneda]


def _ini_trim(q: str) -> str:
    f = dt.date.fromisoformat(q)
    return dt.date(f.year, f.month - 2, 1).isoformat()


def tc(moneda: str, q: str, tipo: str):
    """Unidades de moneda por USD: promedio del trimestre (flujo) o cierre (stock). None si no hay dato."""
    if moneda in ("", "USD", None):
        return 1.0
    s = _fx(moneda)
    if tipo == "flujo":
        v = [x for d, x in s.items() if _ini_trim(q) <= d <= q]
        return sum(v) / len(v) if v else None
    ks = [d for d in s if d <= q]
    return s[max(ks)] if ks else None


def a_usd(fila: dict, q: str, tipo: str):
    m = (fila.get("moneda") or "").upper()
    t = tc(m, q, tipo)
    return None if t is None else fila["valor"] / t


def _fuente(fila: dict) -> str:
    if fila.get("fuente_url"):
        return f"{fila['fuente_url']} ({fila.get('campo_bloomberg') or ''})"
    return f"Bloomberg (terminal UADE), hoja «{fila.get('hoja')}», campo «{fila.get('campo_bloomberg')}»"


def dias(q: str) -> int:
    return (dt.date.fromisoformat(q) - dt.date.fromisoformat(_ini_trim(q))).days + 1


def periodo(emp: str, q: str, datos: dict | None = None) -> dict | None:
    """Trimestre q en formato EDGAR-compatible: {'valores', 'docs', 'fin', 'pub'}; None si no hay datos."""
    datos = leer(emp) if datos is None else datos
    b = datos.get(q)
    if not b:
        return None
    pubs = [r["fecha_publicacion"] for r in b.values() if r.get("fecha_publicacion")]
    pub = max(pubs) if pubs else None
    doc = {"url": f"Bloomberg (terminal UADE) — inputs/bloomberg/{emp}.csv", "form": "Bloomberg", "fecha": pub,
           "periodo": q, "dias": dias(q)}
    val = {}
    def put(k, v, fila):
        if v is not None:
            val[k] = {"valor": v, "doc": "bloomberg", "fuente": _fuente(fila)}
    for k in FISICAS:
        if k in b:
            put(k, b[k]["valor"], b[k])
    for k in PRECIOS:
        if k in b:
            put(k, a_usd(b[k], q, "flujo"), b[k])
    if "p_crudo" not in val and "p_crudo_cad" in b:
        put("p_crudo", a_usd({**b["p_crudo_cad"], "moneda": "CAD"}, q, "flujo"), b["p_crudo_cad"])
    if "ebitda_no_up_mm" not in b and "rm_rai_mm" in b and "rm_dda_mm" in b:   # SU: misma definición que Bloomberg
        b = {**b, "ebitda_no_up_mm": {**b["rm_rai_mm"], "valor": b["rm_rai_mm"]["valor"] + b["rm_dda_mm"]["valor"],
                                      "campo_bloomberg": "R&M: resultado antes de impuestos + DD&A (nota de segmentos)"}}
    for k, ke in A_EDGAR.items():
        if k in b:
            put(REMAP.get(emp, {}).get(ke, ke), a_usd(b[k], q, "flujo"), b[k])
    if "regalias_os_mm" in b:
        put("regalias_os_musd", a_usd(b["regalias_os_mm"], q, "flujo"), b["regalias_os_mm"])
    if "regalias_mm" in b:
        v = a_usd(b["regalias_mm"], q, "flujo")
        put("regalias_kusd", None if v is None else v * 1000, b["regalias_mm"])
    if "reservas_mmboe" in val:
        val["reservas_mmboe"]["anual"] = True
    if "total_kboed" in val:
        val["total_mmboe"] = {"valor": val["total_kboed"]["valor"] * dias(q) / 1000, "doc": "bloomberg",
                              "fuente": val["total_kboed"]["fuente"]}
    fin = {}
    for k in STOCKS:
        if k in b:
            fin[k.replace("_mm", "_musd")] = a_usd(b[k], q, "stock")
    if "acciones_mm" in b:
        fin["acciones_bs"] = b["acciones_mm"]["valor"] * 1e6
    for k in ("acciones_on_mm", "acciones_pn_mm"):
        if k in b:
            fin[k] = b[k]["valor"]
    return {"valores": val, "docs": {"bloomberg": doc}, "fin": {k: v for k, v in fin.items() if v is not None},
            "pub": pub, "flujos": {k: b[k] for k in FLUJOS if k in b}}


def ttm(emp: str, q: str, datos: dict | None = None) -> dict:
    """Flujos TTM (4 trimestres terminados en q) en MUSD, solo si están los 4."""
    datos = leer(emp) if datos is None else datos
    qs = sorted(p for p in datos if p <= q and len(p) == 10 and p[5:] in ("03-31", "06-30", "09-30", "12-31"))[-4:]
    if len(qs) < 4 or qs[-1] != q:
        return {}
    out = {}
    for k, ko in (("capex_mm", "capex_musd_ttm"), ("dda_mm", "dda_musd_ttm"), ("sga_mm", "sga_musd_ttm"),
                  ("intereses_mm", "intereses_musd_ttm"), ("impuesto_ganancias_mm", "_imp"), ("resultado_antes_imp_mm", "_rai")):
        vals = [a_usd(datos[p][k], p, "flujo") if k in datos[p] else None for p in qs]
        if all(v is not None for v in vals):
            out[ko] = abs(sum(vals)) if k in ("capex_mm", "intereses_mm") else sum(vals)
    if out.get("_rai"):
        out["tasa_impuesto_efectiva"] = out["_imp"] / out["_rai"] if "_imp" in out else None
    out.pop("_imp", None); out.pop("_rai", None)
    return out


def fusionar(ed: dict, bb: dict | None) -> dict:
    """EDGAR del trimestre con Bloomberg encima (salvo el EBITDA no-upstream, que solo completa)."""
    if not bb:
        return ed
    val = dict(ed.get("valores") or {})
    nuevo = dict(bb["valores"])
    # EBITDA no-upstream: el ajustado que publica la empresa (EDGAR) es más limpio que el GAAP de Bloomberg
    # (resultado operativo + D&A, con write-downs y cambios de segmentación): Bloomberg solo completa.
    if any(k in val for k in ("ebitda_no_up_q", "ebitda_rtm_q", "ebitda_glce_q")):
        nuevo.pop("ebitda_no_up_q", None)
    # ingresos: el de EDGAR es el denominador de las regalías del mismo release; el de Bloomberg se guarda
    # aparte (bruto de retenciones) para el cociente retenciones / ingresos, que sale entero de Bloomberg.
    if "ingresos_musd" in nuevo:
        nuevo["ingresos_bb_musd"] = nuevo["ingresos_musd"]
        if "ingresos_musd" in val:
            nuevo.pop("ingresos_musd")
    val.update(nuevo)
    docs = dict(ed.get("docs") or {})
    if not docs:
        d = dict(bb["docs"]["bloomberg"])
        if not d["fecha"]:   # sin fecha de anuncio ni EDGAR: plazo de presentación de 45 días (supuesto, se marca)
            d["fecha"] = (dt.date.fromisoformat(d["periodo"]) + dt.timedelta(days=45)).isoformat()
            d["fecha_supuesta"] = True
        docs = {"bloomberg": d}
    else:
        docs["bloomberg"] = {**bb["docs"]["bloomberg"], "fecha": bb["pub"] or max(d["fecha"] for d in docs.values())}
    return {**ed, "valores": val, "docs": docs}


def fin_bloomberg(emp: str, q: str, datos: dict | None = None) -> dict:
    """Balance y flujos TTM en el formato de historia.fin_trimestre / fund_yf (MUSD)."""
    datos = leer(emp) if datos is None else datos
    b = periodo(emp, q, datos)
    if not b:
        return {}
    f = {**b["fin"], **ttm(emp, q, datos)}
    if "deuda_musd" in f:
        f["deuda_neta_musd"] = f["deuda_musd"] - f.get("caja_musd", 0.0)
    if f:
        f["fuente"] = f"Bloomberg (terminal UADE), estados contables al {q}"
        f["base"] = "Bloomberg: stocks al cierre, flujos TTM (4 trimestres)"
    return f


def ultimo_periodo(emp: str) -> str | None:
    d = leer(emp)
    qs = [p for p in d if any(k in d[p] for k in ("crudo_kbd", "total_kboed", "ingresos_mm", "deuda_mm"))]
    return max(qs) if qs else None


def ultima_reserva(emp: str, hasta: str) -> dict | None:
    """Última reserva probada (dato anual) con período ≤ hasta, para la foto actual."""
    d = leer(emp)
    qs = [q for q in d if q <= hasta and "reservas_mmboe" in d[q]]
    if not qs:
        return None
    f = d[max(qs)]["reservas_mmboe"]
    return {"valor": f["valor"], "fuente": _fuente(f), "fecha": max(qs)}
