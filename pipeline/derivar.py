"""Traduce lo extraído (EDGAR, yfinance, SEC/CVM, Damodaran, FRED, Secretaría de Energía) a los inputs del motor.
Cada input sale con: valor, origen (edgar | derivado | macro | supuesto), fuente (link al documento) y la fórmula usada.
Los 'supuesto' son convenciones del modelo, no datos: se muestran en ámbar y se editan desde la página."""
import datetime as dt

BOE_MMBTU = 5.8   # 1 boe ≈ 5,8 MMBtu (convención de industria)


def _brent_trimestre(spot: list, fin: str):
    f = dt.date.fromisoformat(fin)
    ini = dt.date(f.year, f.month - 2, 1)
    vals = [v for d, v in spot if ini.isoformat() <= d <= fin]
    return (sum(vals) / len(vals), len(vals)) if vals else (None, 0)


TRIM = {"1T": "03-31", "2T": "06-30", "3T": "09-30", "4T": "12-31"}


def derivar(c: dict, ed: dict, y: dict, macro: dict, spot: list, cap: float | None, sem: dict, edgar_all: dict | None = None) -> dict:
    out = {}
    semv = lambda k: (sem.get(k) or {}).get("valor")
    V = {k: v["valor"] for k, v in (ed.get("valores") or {}).items()}
    docs = ed.get("docs") or {}
    url = lambda campo: docs.get((ed["valores"][campo]["doc"]))["url"] if campo in V else None
    per = next(iter(docs.values()), {}).get("periodo")
    if not per:   # sin EDGAR (PRIO): período de la semilla, ej. "2T2026"
        t_ = next((v.get("trimestre") for v in sem.values() if str(v.get("trimestre", ""))[:2] in TRIM), None)
        per = f"{t_[2:]}-{TRIM[t_[:2]]}" if t_ else None
    dias = next(iter(docs.values()), {}).get("dias", 91)
    def put(k, v, origen, fuente, formula):
        if v is not None:
            out[k] = {"valor": v, "origen": origen, "fuente": fuente, "fecha": per, "nota": formula}

    # ---------- producción
    crudo = V.get("crudo_kbd")
    if crudo is None and "brasil_kboed" in V and "gas_kboed" in V:
        crudo = V["brasil_kboed"] - V["gas_kboed"]
    if crudo is None:
        crudo = semv("prod_crudo_kbd")
    if crudo is not None and "bitumen_kbd" in V:
        crudo += V["bitumen_kbd"]
    put("prod_crudo_kbd", crudo, "edgar", url("crudo_kbd"), "Producción de crudo del período" + (" (+ bitumen)" if "bitumen_kbd" in V else ""))
    total = V.get("total_kboed")
    otros = total - crudo if total is not None and crudo is not None else None
    put("prod_otros_kboed", otros, "derivado", url("total_kboed"), "Total boe/d − crudo (gas + NGL)")
    if otros is None and crudo is not None and c["id"] == "PRIO":
        otros = 0.0
        put("prod_otros_kboed", 0.0, "supuesto", None, "PRIO informa producción total sin desagregar gas (marginal): se toma 0")
        put("precio_otros_usd_boe", 0.0, "supuesto", None, "Sin producción de gas separada: irrelevante")

    # ---------- precio de gas + NGL (fijo, no ligado al Brent)
    p_otros, f_otros = None, None
    if otros and "p_gas_mcf" in V:
        p_otros = (V.get("ngl_kbd", 0) * V.get("p_ngl", 0) + V["gas_mmcfd"] * V["p_gas_mcf"]) / otros
        f_otros = "(NGL × precio NGL + gas MMcfd × precio $/Mcf) / (gas + NGL en boe)"
    elif "p_gas_mmbtu" in V:
        p_otros, f_otros = V["p_gas_mmbtu"] * BOE_MMBTU, "Precio de gas $/MMBtu × 5,8 MMBtu/boe (NGL al mismo precio: aproximación)"
    elif "p_gas_boe" in V:
        p_otros, f_otros = V["p_gas_boe"], "Precio de venta de gas en Brasil (US$/boe equivalente)"
    if p_otros is None and c["region"] == "Argentina" and edgar_all:
        pg = ((edgar_all.get("YPF") or {}).get("valores") or {}).get("p_gas_mmbtu")
        if pg:
            p_otros, f_otros = pg["valor"] * BOE_MMBTU, "Precio de gas en Argentina informado por YPF ($/MMBtu × 5,8): Vista no lo publica en texto"
    if p_otros is not None:
        put("precio_otros_usd_boe", p_otros, "derivado", url("p_gas_mcf") or url("p_gas_mmbtu") or url("p_gas_boe"), f_otros)

    # ---------- diferencial de realización vs Brent del mismo trimestre
    ar = (macro.get("argentina") or {}).get("serie", [])
    if c["id"] == "VIST" and ar and per and "p_crudo" not in V:
        meses = [s for s in ar if s["mes"] <= per[:7]][-3:]
        med = sum(s["medanito_usd_bbl"] for s in meses) / len(meses); br = sum(s["brent_usd_bbl"] for s in meses) / len(meses)
        put("diferencial_pct", 1 - med / br, "derivado", (macro.get("argentina") or {}).get("fuente"),
            f"1 − Medanito/Brent (SE, promedio {meses[0]['mes']} a {meses[-1]['mes']}): Vista vende 100 % a paridad de exportación, el Medanito es su referencia")
    else:
        pc = V.get("p_crudo") or (sem.get("p_crudo") or {}).get("valor")
        br, n = _brent_trimestre(spot, per) if per else (None, 0)
        if pc and br:
            fuente = url("p_crudo") or (sem.get("p_crudo") or {}).get("fuente")
            put("diferencial_pct", 1 - pc / br, "derivado", fuente,
                f"1 − precio realizado ({pc:.2f}) / Brent Dated promedio del trimestre ({br:.2f}, FRED, {n} ruedas)")
        elif c["id"] == "PBR":
            put("diferencial_pct", 0.0, "supuesto", None, "Petrobras no publica precio realizado de crudo: se supone paridad Brent (editar)")

    # ---------- regalías / impuestos a la producción (% del ingreso)
    if "toti_musd" in V and crudo:
        ing = dias * (V["crudo_kbd"] * V["p_crudo"] + V.get("bitumen_kbd", 0) * V["p_crudo"] + V.get("ngl_kbd", 0) * V.get("p_ngl", 0)
                      + V.get("gas_mmcfd", 0) * V.get("p_gas_mcf", 0)) / 1000
        put("regalias_pct", V["toti_musd"] / ing, "derivado", url("toti_musd"),
            "Impuestos distintos de ganancias / ingreso upstream (volumen × precio). Los volúmenes SEC ya son netos de regalías")
    elif "regalias_kusd" in V and V.get("ingresos_musd"):
        put("regalias_pct", V["regalias_kusd"] / 1000 / V["ingresos_musd"], "derivado", url("regalias_kusd"),
            "Regalías y otros / ingresos totales del trimestre (release)")
    elif c["region"] == "Argentina" and ar:
        vals = [s["regalias_pct_neuquen"] for s in ar[-3:] if s["regalias_pct_neuquen"]]
        put("regalias_pct", sum(vals) / len(vals), "derivado", (macro.get("argentina") or {}).get("fuente"),
            "Regalías liquidadas / (producción × precio), Neuquén, últimos 3 meses (SE)")
    elif "lifting_pt_boe" in V and V.get("brent_q"):
        put("regalias_pct", (V["lifting_pt_boe"] - V["lifting_boe"]) / V["brent_q"], "derivado", url("lifting_pt_boe"),
            "(Lifting + production taxes − lifting) / Brent del trimestre: regalías + participación especial")
    elif c["id"] == "PRIO":
        put("regalias_pct", 0.10, "supuesto", "https://www.planalto.gov.br/ccivil_03/leis/l9478.htm",
            "Regalía estándar 10 % (Lei 9.478/1997, art. 47); no incluye participación especial")

    # ---------- derechos de exportación
    if "retenciones_musd" in V and V.get("ingresos_musd"):
        put("retencion_pct", V["retenciones_musd"] / V["ingresos_musd"], "derivado", url("retenciones_musd"),
            "Derechos de exportación del trimestre / ingresos brutos")
    else:
        put("retencion_pct", 0.0, "supuesto", None, "Sin derechos de exportación informados (AR: Dto. 59/2026 exime no convencional hasta USD 65; editar si aplica)")

    # ---------- costos por boe
    boe_anual = (crudo + otros) * 365 / 1000 if crudo and otros is not None else None   # MMboe/año
    mmboe_per = V.get("total_mmboe")
    if "lifting_boe" in V:
        put("lifting_usd_boe", V["lifting_boe"], "edgar", url("lifting_boe"), "Lifting cost informado por la empresa")
    elif "opex_musd" in V and mmboe_per:
        put("lifting_usd_boe", V["opex_musd"] / mmboe_per, "derivado", url("opex_musd"), "Production & operating expenses / MMboe del período")
    if "gpt_boe" in V:
        put("otros_costos_usd_boe", V["gpt_boe"] + V.get("ga_boe", 0), "edgar", url("gpt_boe"), "GP&T + G&A por boe")
    elif "sga_musd" in V and mmboe_per:
        put("otros_costos_usd_boe", V["sga_musd"] / mmboe_per, "derivado", url("sga_musd"), "SG&A / MMboe del período")
    elif y.get("sga_musd_ttm") and boe_anual:
        put("otros_costos_usd_boe", y["sga_musd_ttm"] / boe_anual, "derivado", y.get("fuente"),
            "SG&A TTM (yfinance) / producción anual (EDGAR)" + (" — integrada: incluye downstream" if c["perfil"] == "integrada" else ""))
    if "dda_boe" in V:
        put("dda_usd_boe", V["dda_boe"], "edgar", url("dda_boe"), "DD&A de activos de petróleo y gas por boe")
    elif "dda_musd" in V and mmboe_per:
        put("dda_usd_boe", V["dda_musd"] / mmboe_per, "derivado", url("dda_musd"), "DD&A / MMboe del período")
    elif y.get("dda_musd_ttm") and boe_anual:
        put("dda_usd_boe", y["dda_musd_ttm"] / boe_anual, "derivado", y.get("fuente"), "DD&A TTM (yfinance) / producción anual (EDGAR)")

    # ---------- segmentos no-upstream (integradas): EBITDA del segmento × 4 × EV/EBITDA sectorial
    d0 = macro.get("damodaran") or {}
    if c["perfil"] == "integrada":
        eb = sum(V.get(k, 0) for k in ("ebitda_no_up_q", "ebitda_rtm_q", "ebitda_glce_q"))
        mult = (d0.get("ev_ebitda_integradas") or {}).get("valor")
        if eb and mult:
            put("valor_no_upstream_musd", eb * 4 * mult, "derivado", url("ebitda_no_up_q") or url("ebitda_rtm_q"),
                f"EBITDA ajustado de segmentos no-upstream del trimestre ({eb:,.0f}) × 4 × EV/EBITDA Oil/Gas Integrated de Damodaran ({mult:.2f}). Aproximación gruesa: banda ancha")
    else:
        put("valor_no_upstream_musd", 0.0, "supuesto", None, "Pure-play: sin segmentos no-upstream")

    # ---------- impuestos y costo de capital
    d = macro.get("damodaran") or {}
    tm = (d.get("tasa_marginal") or {}).get(c["region"], {})
    put("tasa_impuesto", tm.get("valor"), "macro", tm.get("fuente"), "Tasa marginal del país (Damodaran); efectiva TTM como referencia en yfinance")
    if macro.get("rf"):
        put("rf", macro["rf"]["valor"], "macro", macro["rf"]["fuente"], f"UST 10 años al {macro['rf']['fecha']}")
    if d.get("erp"):
        put("erp", d["erp"]["valor"], "macro", d["erp"]["fuente"], "ERP de mercado maduro")
    crp = (d.get("crp") or {}).get(c["region"], {})
    put("crp", crp.get("valor"), "macro", crp.get("fuente"), "Prima de riesgo país (default spread × volatilidad relativa)")
    put("lambda_crp", 1.0, "supuesto", None, "Exposición unitaria al riesgo país (caso base, MT 7.2.2)")
    deuda, t = y.get("deuda_musd"), tm.get("valor")
    bu = ((d.get("beta_u") or {}).get(c["perfil"]) or {})
    if bu.get("valor") and cap and deuda is not None and t is not None:
        put("beta", bu["valor"] * (1 + (1 - t) * deuda / cap), "derivado", bu.get("fuente"),
            f"Beta desapalancada sectorial {bu['valor']:.3f} reapalancada con D/E de mercado ({deuda:,.0f}/{cap:,.0f}) — Hamada")
        put("peso_deuda", deuda / (deuda + cap), "derivado", y.get("fuente"), "Deuda / (deuda + capitalización)")
    if y.get("intereses_musd_ttm") and deuda:
        rf_ = (macro.get("rf") or {}).get("valor", 0)
        kd = min(max(y["intereses_musd_ttm"] / deuda, rf_), rf_ + 0.10)
        put("kd", kd, "derivado", y.get("fuente"), "Intereses TTM / deuda total (acotado entre rf y rf + 10 pp)")

    # ---------- perfil de producción (convención del modelo)
    put("crecimiento_anual", 0.0, "supuesto", None, "Caso base: producción plana hasta agotar reservas probadas (R/P)")
    put("anios_crecimiento", 0, "supuesto", None, "Caso base: sin tramo de crecimiento")
    put("declino_anual", 0.0, "supuesto", None, "Caso base: sin declino hasta agotar reservas probadas")
    return out
