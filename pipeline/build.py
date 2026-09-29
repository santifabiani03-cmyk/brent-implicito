"""Une mercado + fundamentals + inputs del equipo, corre el motor y escribe web/data.json."""
import csv, json, datetime as dt
from collections import defaultdict
from .common import RAIZ, cargar, ahora_iso, companias
from engine import model
from .derivar import derivar

MAX_EDAD_H = {"mercado.json": 48, "brent.json": 96, "fx.json": 96, "fund_sec.json": 24 * 120, "fund_cvm.json": 24 * 120,
              "fund_yf.json": 24 * 120, "ar_se.json": 24 * 45, "edgar.json": 24 * 7, "macro.json": 24 * 7, "serie.json": 24 * 7}


def inputs_equipo(archivo: str = "operativos.csv", origen: str = "equipo") -> dict:
    """Último valor por (empresa, variable), respetando el trimestre más reciente cargado."""
    out = defaultdict(dict)
    p = RAIZ / "inputs" / archivo
    if not p.exists():
        return out
    with p.open(encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            prev = out[r["empresa"]].get(r["variable"])
            if not r["fuente_url"]:
                continue  # regla: sin fuente no entra
            if prev is None or r["fecha_publicacion"] >= prev["fecha_publicacion"]:
                out[r["empresa"]][r["variable"]] = {"valor": float(r["valor"]), "trimestre": r["trimestre"],
                                                     "fecha_publicacion": r["fecha_publicacion"],
                                                     "fuente": r["fuente_url"], "origen": origen,
                                                     "nota": r.get("pagina_o_tabla")}
    return out


def _historia():
    h = cargar("serie.json")
    if not h:
        return None
    for e, s in h["series"].items():
        periodos = sorted(set(s["calibracion"]))
        s["cal_idx"] = [periodos.index(x) for x in s["calibracion"]]
        s["periodos"] = periodos
        s.pop("calibracion"); s.pop("cap_musd", None)
    for e, ls in h["calibraciones"].items():
        for k in ls:
            k.pop("inputs", None)
    return h


def estado_fuentes() -> list:
    out, ahora = [], dt.datetime.now(dt.timezone.utc)
    for arch, maxh in MAX_EDAD_H.items():
        d = cargar(arch)
        if not d:
            out.append({"archivo": arch, "estado": "sin datos", "actualizado": None}); continue
        edad = (ahora - dt.datetime.fromisoformat(d["actualizado"])).total_seconds() / 3600
        out.append({"archivo": arch, "actualizado": d["actualizado"], "estado": "ok" if edad <= maxh else "desactualizado",
                    "errores": d.get("errores") or None})
    return out


def main():
    mercado, brent, fx = cargar("mercado.json", {}), cargar("brent.json", {}), cargar("fx.json", {})
    fund = {**cargar("fund_sec.json", {}).get("empresas", {}), **cargar("fund_cvm.json", {}).get("empresas", {})}
    params = json.loads((RAIZ / "config" / "parametros.json").read_text(encoding="utf-8"))
    equipo = inputs_equipo()
    semillas = inputs_equipo("semillas.csv", "semilla")
    yfd = cargar("fund_yf.json", {}).get("empresas", {})
    ar = cargar("ar_se.json", {})
    edgar = cargar("edgar.json", {}).get("empresas", {})
    macro = cargar("macro.json", {})
    cot = mercado.get("cotizaciones", {})
    empresas = []
    for c in companias():
        q, f, eq = cot.get(c["id"], {}), fund.get(c["id"], {}), equipo.get(c["id"], {})
        # --- inputs: automático < derivado < parámetros < semilla (dato citado) < equipo (siempre pisa)
        ins = {}
        y, sem = yfd.get(c["id"], {}), semillas.get(c["id"], {})
        def auto(k, v, fuente, fecha=None, origen="automatico", nota=None):
            if v is not None:
                ins[k] = {"valor": v, "fuente": fuente, "fecha": fecha, "origen": origen, "nota": nota}
        # balance: oficial (SEC/CVM) primero, yfinance como respaldo
        for k in ("deuda_neta_musd", "acciones_mm"):
            if f.get(k):
                auto(k, f[k], f.get("fuente"), f.get("fecha"))
            elif y.get(k) is not None:
                auto(k, y[k], y["fuente"], y.get("cierre"), nota="⚠️ moneda a verificar" if y.get("moneda_verificar") else None)
        auto("minoritarios_musd", y.get("minoritarios_musd"), y.get("fuente"), y.get("cierre"))
        auto("capex_musd_anual", y.get("capex_musd_ttm"), y.get("fuente"), y.get("cierre"),
             nota="Capex TTM del estado de flujos: puede incluir adquisiciones; revisar")
        t = y.get("tasa_impuesto_efectiva")
        if t is not None and 0.1 <= t <= 0.45:
            auto("tasa_impuesto", t, y.get("fuente"), y.get("cierre"), nota="Tasa efectiva TTM (impuesto / resultado antes de impuestos)")
        # producción y reservas oficiales (Argentina, base operado)
        for k in ("prod_crudo_kbd", "prod_otros_kboed"):
            if c["id"] in ar.get("produccion", {}):
                p_ = ar["produccion"][c["id"]]
                auto(k, p_[k], p_["fuente"], p_["meses"][-1], nota="Producción OPERADA, no por participación: ajustar")
        if c["id"] in ar.get("reservas", {}):
            auto("reservas_1p_mmboe", ar["reservas"][c["id"]]["reservas_1p_mmboe"], ar["reservas"][c["id"]]["fuente"],
                 nota="Reservas comprobadas OPERADAS (SE), no por participación: ajustar")
        for k in ("rf", "erp", "lambda_crp"):
            if params[k]["valor"] is not None:
                auto(k, params[k]["valor"], params[k]["fuente"], origen="parametro")
        crp = params["crp"].get(c["region"], {})
        if crp.get("valor") is not None:
            auto("crp", crp["valor"], crp["fuente"], origen="parametro")
        ins.update(sem)
        # --- capitalización (MUSD)
        acc = ins.get("acciones_mm", {}).get("valor")
        cap, nota_cap = None, None
        if q.get("precio") and acc:
            if c["id"] == "PBR" and f.get("on_mm") and cot.get("PBR_PREF", {}).get("precio"):
                cap = (f["on_mm"] * q["precio"] + f["pn_mm"] * cot["PBR_PREF"]["precio"]) / c["ratio_adr_acciones"]
                nota_cap = "ON×PBR/2 + PN×PBR-A/2"
            elif c["moneda_cotizacion"] == "BRL" and fx.get("usd_brl"):
                cap = q["precio"] * acc / fx["usd_brl"]
                nota_cap = f"precio BRL × acciones / PTAX {fx['usd_brl']}"
            else:
                cap = q["precio"] * acc / c["ratio_adr_acciones"]
                nota_cap = f"precio × acciones / ratio ADR {c['ratio_adr_acciones']}"
        mc_y = y.get("mcap_yahoo_musd")
        if mc_y and c["moneda_cotizacion"] == "BRL" and fx.get("usd_brl"):
            mc_y = mc_y / fx["usd_brl"]
        if cap and mc_y and abs(cap / mc_y - 1) > 0.25:
            nota_cap = (nota_cap or "") + f" ⚠️ difiere >25 % de la capitalización de Yahoo ({mc_y:,.0f} MUSD): revisar acciones"
        # derivación desde EDGAR + macro (pisa a lo automático de baja prioridad y a las semillas; el equipo pisa todo)
        der = derivar(c, edgar.get(c["id"], {}), y, macro, (brent or {}).get("spot", []), cap, sem, edgar)
        for k, v in der.items():
            if k in sem and v["origen"] == "supuesto":
                continue
            ins[k] = v
        for k, v in sem.items():
            if k not in der and k not in ins:
                ins[k] = v
        ins.update(eq)
        # --- motor
        plano = {k: v["valor"] for k, v in ins.items()}
        faltan = [k for k in model.CAMPOS_REQUERIDOS if plano.get(k) is None]
        resultado = {"estado": "pendiente_calibracion", "faltan": faltan}
        if not faltan and cap:
            i = model.Inputs.desde_dict(plano)
            bi = model.brent_implicito(i, cap)
            resultado = {"estado": bi["estado"], "brent_implicito": bi.get("valor"), "wacc": model.wacc(i),
                         "banda": model.banda(i, cap), "sensibilidad": model.sensibilidad(i, cap)}
        empresas.append({**{k: c[k] for k in c}, "mercado": {**{k: q.get(k) for k in ("precio", "moneda", "ts", "fuente")},
                         "cap_musd": cap, "nota_cap": nota_cap, "serie_1y": q.get("serie_1y", [])[-260:]},
                         "fundamentals": {k: f.get(k) for k in ("fecha", "deuda_musd", "caja_musd", "deuda_neta_musd", "acciones_mm", "fuente")},
                         "inputs": ins, "resultado": resultado})
    out = {"generado": ahora_iso(), "campos_requeridos": model.CAMPOS_REQUERIDOS,
           "brent": {k: brent.get(k) for k in ("spot", "primera_linea", "curva", "fuentes")},
           "brent_referencia": params["brent_referencia"]["valor"], "fx": fx, "empresas": empresas,
           "fuentes_estado": estado_fuentes(),
           "historia": _historia(),
           "notas": json.loads((RAIZ / "config" / "pendientes.json").read_text(encoding="utf-8")),
           "edgar": {e: {"docs": r.get("docs"), "fallas": r.get("fallas")} for e, r in edgar.items()}}
    (RAIZ / "web" / "data.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    print("data.json:", len(empresas), "empresas;", sum(e["resultado"]["estado"] == "ok" for e in empresas), "calibradas")


if __name__ == "__main__":
    main()
