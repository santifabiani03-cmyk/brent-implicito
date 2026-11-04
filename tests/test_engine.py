"""Tests del motor con un caso SINTÉTICO (no corresponde a ninguna empresa; no usar en el TIF)."""
import json, subprocess, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from engine import model

SINTETICO = dict(prod_crudo_kbd=100, prod_otros_kboed=20, precio_otros_usd_boe=20, diferencial_pct=0.1,
    regalias_pct=0.12, retencion_pct=0.0, lifting_usd_boe=10, otros_costos_usd_boe=5, capex_musd_anual=800,
    dda_usd_boe=12, tasa_impuesto=0.3, reservas_1p_mmboe=400, crecimiento_anual=0.05, anios_crecimiento=3,
    declino_anual=0.1, deuda_neta_musd=1000, minoritarios_musd=0, valor_no_upstream_musd=0,
    rf=0.04, beta=1.1, erp=0.05, crp=0.0, lambda_crp=1, kd=0.07, peso_deuda=0.3)


def test_monotonia():
    i = model.Inputs.desde_dict(SINTETICO)
    vals = [model.valor_patrimonio(i, b) for b in range(20, 201, 10)]
    assert all(b > a for a, b in zip(vals, vals[1:]))


def test_ida_y_vuelta():
    """Si la capitalización es el valor del modelo a Brent=80, el despeje debe devolver 80."""
    i = model.Inputs.desde_dict(SINTETICO)
    cap = model.valor_patrimonio(i, 80.0)
    assert abs(model.brent_implicito(i, cap)["valor"] - 80.0) < 0.01


def test_reservas_acotan_horizonte():
    i = model.Inputs.desde_dict(SINTETICO)
    assert abs(sum(model.perfil_produccion(i)) - 400) < 1e-6


def test_faltantes():
    d = dict(SINTETICO); d.pop("beta")
    try:
        model.Inputs.desde_dict(d); assert False
    except ValueError as e:
        assert "beta" in str(e)


def test_banda_de_8_3():
    """Costo de capital ±1 punto porcentual exacto y costos (lifting + otros) ±10 %."""
    i = model.Inputs.desde_dict(SINTETICO)
    assert abs(model.wacc(model._perturbar(i, "wacc_pp", 0.01)) - model.wacc(i) - 0.01) < 1e-12
    c = model._perturbar(i, "costos_rel", 0.10)
    assert abs(c.lifting_usd_boe - 11) < 1e-9 and abs(c.otros_costos_usd_boe - 5.5) < 1e-9 and c.diferencial_pct == i.diferencial_pct
    assert {k for k, _ in model.BANDA} == {"wacc_pp", "costos_rel"}


def test_petrobras_en_reales(monkeypatch):
    """Release en R$ (…rs_6k.htm): el EBITDA de segmentos pasa a USD. Release en USD: no se toca."""
    from pipeline import historia, bloomberg
    monkeypatch.setattr(bloomberg, "tc", lambda m, q, t: 5.0)
    ed = {"docs": {"resultados": {"url": "https://x/pbrrmf1q24rs_6k.htm"}},
          "valores": {"ebitda_rtm_q": {"valor": 9875.0}, "ebitda_glce_q": {"valor": 2405.0}, "lifting_boe": {"valor": 6.04}}}
    v = historia.reales_a_usd(ed, "2024-03-31")["valores"]
    assert v["ebitda_rtm_q"]["valor"] == 1975 and v["ebitda_glce_q"]["valor"] == 481 and v["lifting_boe"]["valor"] == 6.04
    assert ed["valores"]["ebitda_rtm_q"]["valor"] == 9875     # no modifica la caché leída
    usd = {"docs": {"resultados": {"url": "https://x/pbrrmf3q24usd_6k.htm"}}, "valores": {"ebitda_rtm_q": {"valor": 1078.0}}}
    assert historia.reales_a_usd(usd, "2024-09-30")["valores"]["ebitda_rtm_q"]["valor"] == 1078


def test_eog_cuarto_trimestre_del_release():
    """Filas reales del release 4T24 de EOG: el noveno número es el 4T corriente, no el año (77,40)."""
    import re
    from pipeline.recetas import RECETAS
    from pipeline.fetch_edgar import _num
    c = RECETAS["EOG"]["campos"]
    p = ("Average Crude Oil and Condensate Prices ($/Bbl) (B) United States $ 77.27 $ 74.98 $ 83.61 $ 80.61 $ 79.18 $ 78.46 $ 82.71 $ 76.95 $ 71.68 $ 77.42 "
         "Trinidad 68.98 64.88 71.38 69.21 65.58 67.50 70.75 63.15 60.47 64.43 Composite 77.26 74.97 83.60 80.60 79.17 78.45 82.69 76.92 71.66 77.40 Natural")
    assert _num(re.search(c["p_crudo_q4"][1], p).group(1)) == 71.66
    v = ("Crude Oil and Condensate Volumes (MBbld) (A) United States 457.1 476.0 482.8 484.6 475.2 486.8 490.1 491.8 493.5 490.6 Trinidad 0.6 0.6 0.5 0.6 0.6 0.6 0.6 1.2 1.1 0.8 "
         "Total 457.7 476.6 483.3 485.2 475.8 487.4 490.7 493.0 494.6 491.4 Average")
    assert _num(re.search(c["crudo_kbd_q4"][1], v).group(1)) == 494.6
    g = "Natural Gas Volumes (MMcfd) (A) United States 1,475 1,513 1,562 1,653 1,551 1,658 1,668 1,745 1,840 1,728 Trinidad 164 155 142 178 160 200 204 225 252 220 Total 1,639 1,668 1,704 1,831 1,711 1,858 1,872 1,970 2,092 1,948 Average"
    assert _num(re.search(c["gas_mmcfd_q4"][1], g).group(1)) == 2092


def test_eog_gpt_con_redaccion_vieja():
    import re
    from pipeline.recetas import RECETAS
    pats = RECETAS["EOG"]["campos"]["gpt_boe"][1]
    # primero aparece la tabla de compensación en acciones, en millones, con el mismo rótulo: no hay que tomarla
    t = ("Lease and Well $ 13 $ 12 Gathering, Processing and Transportation Costs 2 1 Exploration Costs 6 5 "
         "Lease and Well $ 4.23 $ 4.23 Gathering, Processing and Transportation Costs 4.41 4.65 Depreciation")
    assert next(re.search(p, t) for p in pats if re.search(p, t)).group(1) == "4.41"


def test_derivar_usa_trimestre_y_regalias_del_ano():
    """En un 10-K, producción y precio son los del 4T del release; las regalías, impuestos y volúmenes del año."""
    from pipeline.derivar import derivar
    val = lambda v, d="periodico": {"valor": v, "doc": d}
    ed = {"docs": {"periodico": {"url": "u", "periodo": "2024-12-31", "dias": 365}},
          "valores": {"crudo_kbd": val(100.0), "p_crudo": val(80.0), "total_kboed": val(150.0), "toti_musd": val(292.0),
                      "crudo_kbd_q4": val(110.0, "periodico"), "p_crudo_q4": val(70.0, "periodico"), "total_kboed_q4": val(160.0, "periodico")}}
    c = {"id": "EOG", "region": "Norteamérica", "perfil": "pure-play"}
    d = derivar(c, ed, {}, {}, [("2024-11-01", 75.0)], None, {}, None)
    assert d["prod_crudo_kbd"]["valor"] == 110 and d["prod_otros_kboed"]["valor"] == 50
    assert abs(d["diferencial_pct"]["valor"] - (1 - 70 / 75)) < 1e-9
    assert abs(d["regalias_pct"]["valor"] - 292 / (365 * 100 * 80 / 1000)) < 1e-9


def test_prio_fob_de_sus_releases():
    """Receita Total - FOB / Offtakes reproduce los FOB publicados, y todos los trimestres cargados tienen dato con fuente."""
    from pipeline import bloomberg
    d = bloomberg.leer("PRIO")
    for q, publicado in (("2024-06-30", 81.86), ("2025-12-31", 55.49), ("2026-03-31", 75.34), ("2026-06-30", 87.69)):
        assert d[q]["p_crudo_fob"]["valor"] == publicado
    for q in ("2023-09-30", "2024-03-31", "2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30"):
        f = d[q]["p_crudo_fob"]
        assert f["fuente_url"].startswith("https://") and f["valor"] < d[q]["p_crudo"]["valor"]


def test_prio_regalias_e_impuestos_sobre_ingreso_fob():
    from pipeline.derivar import derivar
    val = lambda v: {"valor": v, "doc": "bloomberg"}
    ed = {"docs": {"bloomberg": {"url": "u", "periodo": "2026-06-30", "dias": 91}},
          "valores": {"p_crudo": val(87.69), "crudo_kbd": val(172.0), "total_kboed": val(172.0), "regalias_kusd": val(179434.0), "ingresos_fob_musd": val(1337.464),
                      "ingresos_musd": val(1389.98), "ingresos_bb_musd": val(1389.98), "retenciones_musd": val(113.952)}}
    d = derivar({"id": "PRIO", "region": "Brasil", "perfil": "pure-play"}, ed, {}, {}, [("2026-05-01", 96.68)], None, {}, None)
    assert abs(d["regalias_pct"]["valor"] - 179.434 / 1337.464) < 1e-9 and abs(d["retencion_pct"]["valor"] - 113.952 / 1337.464) < 1e-9
    assert abs(d["diferencial_pct"]["valor"] - (1 - 87.69 / 96.68)) < 1e-9
    ed["valores"]["regalias_kusd"]["fuente"] = "https://release (p.12)"
    d = derivar({"id": "PRIO", "region": "Brasil", "perfil": "pure-play"}, ed, {}, {}, [("2026-05-01", 96.68)], None, {}, None)
    assert d["regalias_pct"]["fuente"] == "https://release (p.12)" and d["retencion_pct"]["fuente"] == "u"   # cada dato cita su propia fuente; sin ella, el documento


def test_capex_prio_anualiza_sin_cuatro_trimestres():
    from pipeline import bloomberg
    f = lambda v: {"valor": v, "moneda": "USD"}
    d = {"2023-09-30": {"capex_mm": f(200.0)}, "2023-12-31": {"capex_mm": f(100.0)}, "2024-03-31": {"capex_mm": f(300.0), "capex_adquisiciones_mm": f(60.0)}}
    assert bloomberg.ttm("PRIO", "2024-03-31", d)["capex_musd_ttm"] == (200 + 100 + 240) / 3 * 4
    assert bloomberg.ttm("VIST", "2024-03-31", d) == {}


def test_riesgo_pais_al_dia():
    """Último dato disponible; sin dato anterior, None; regiones sin serie (mercados desarrollados), 0."""
    from pipeline.riesgo_pais import al_dia
    s = {"Argentina": {"2025-01-02": .07, "2025-01-06": .08}}
    assert al_dia(s, "Argentina", "2025-01-05") == .07 and al_dia(s, "Argentina", "2025-01-06") == .08
    assert al_dia(s, "Argentina", "2024-12-31") is None
    assert al_dia(s, "Norteamérica", "2025-01-05") == 0.0


def test_crp_diario_mueve_wacc_y_refinacion():
    d = dict(SINTETICO, ebitda_no_up_12m_musd=500.0)
    i = model.Inputs.desde_dict(d)
    j = model.con_crp(i, 0.05)
    assert abs(model.wacc(j) - model.wacc(i) - (1 - i.peso_deuda) * 0.05) < 1e-12
    assert abs(j.valor_no_upstream_musd - model.valor_refinacion(j)) < 1e-9 and j.valor_no_upstream_musd < model.valor_refinacion(i)
    k = model.con_crp(model.Inputs.desde_dict(SINTETICO), 0.05)
    assert k.valor_no_upstream_musd == 0


def test_despeje_diario_js_igual_al_motor():
    """La forma cerrada de la estadística y del Excel, con el riesgo país del día, da lo mismo que la bisección del motor."""
    base = dict(SINTETICO, crecimiento_anual=0, anios_crecimiento=0, declino_anual=0, ebitda_no_up_12m_musd=500.0)
    base["valor_no_upstream_musd"] = model.valor_refinacion(model.Inputs.desde_dict(base))
    i = model.con_crp(model.Inputs.desde_dict(base), 0.06)
    cap = model.valor_patrimonio(i, 80.0)
    js = pathlib.Path(__file__).resolve().parents[1] / "web" / "excel_stats.js"
    code = f"""global.window={{}}; require({json.dumps(str(js))}); const S=window.BIStats, x={json.dumps(base)};
      console.log(JSON.stringify(S.despejeDia(x, 0.06, {cap})))"""
    assert abs(json.loads(subprocess.check_output(["node", "-e", code])) - 80.0) < 0.005


def test_fecha_co1():
    """La exportación mezcla texto mm/dd/aaaa con fechas de Excel que tienen día y mes invertidos."""
    import datetime as dt
    from pipeline.bloomberg import fecha_co1
    assert fecha_co1("10/30/2026") == "2026-10-30"
    assert fecha_co1(dt.datetime(2026, 3, 11)) == "2026-11-03"
    assert fecha_co1(dt.datetime(2023, 8, 12)) == "2023-12-08"


def test_regalias_vista_con_llamada_de_nota():
    """En 2024 el release escribe "Royalties and others (1) (56,790 )": el (1) es una nota, no el monto."""
    import re
    from pipeline.recetas import RECETAS
    from pipeline.fetch_edgar import _num
    pat = RECETAS["VIST"]["campos"]["regalias_kusd"][1]
    assert abs(_num(re.search(pat, "Royalties and others (1) (56,790 ) (44,782 )").group(1))) == 56790
    assert abs(_num(re.search(pat, "Royalties and others (68,254 ) (73,896 )").group(1))) == 68254


def test_refinacion_por_flujos():
    """TIF 7.4: flujo de 12 meses después de impuesto, con el mismo WACC y horizonte que el upstream. Se recalcula si cambia el WACC."""
    d = dict(SINTETICO, crecimiento_anual=0, anios_crecimiento=0, declino_anual=0, valor_no_upstream_musd=0, ebitda_no_up_12m_musd=500.0)
    i = model.Inputs.desde_dict(d)
    r, q = model.wacc(i), (100 + 20) * 365 / 1000
    a_mano = sum(min(q, 400 - q * (t - 1)) / (1 + r) ** (t - .5) for t in range(1, 11) if 400 - q * (t - 1) > 0) / q
    assert abs(model.factor_descuento(i) - a_mano) < 1e-9
    assert abs(model.valor_refinacion(i) - 500 * .7 * a_mano) < 1e-6
    sube = model._perturbar(i, "wacc_pp", 0.01)
    assert sube.valor_no_upstream_musd < model.valor_refinacion(i) and abs(sube.valor_no_upstream_musd - model.valor_refinacion(sube)) < 1e-9
    costos = model._perturbar(i, "costos_rel", 0.10)
    assert abs(costos.valor_no_upstream_musd - model.valor_refinacion(i)) < 1e-9


def test_refinacion_12m():
    """Anualiza lo publicado en los últimos 4 trimestres: al principio de la serie hay menos."""
    from pipeline.derivar import ebitda_12m
    s = [(100, 10.0), (101, 20.0), (102, 30.0), (103, 40.0), (104, 50.0)]
    assert ebitda_12m(s, 100) == (40.0, 1)
    assert ebitda_12m(s, 102) == (80.0, 3)
    assert ebitda_12m(s, 104) == (140.0, 4)
    assert ebitda_12m([], 104) == (None, 0)


def test_paridad_refinacion_js():
    d = dict(SINTETICO, ebitda_no_up_12m_musd=500.0)
    i = model.Inputs.desde_dict(d)
    d["valor_no_upstream_musd"] = model.valor_refinacion(i)
    i = model.Inputs.desde_dict(d)
    cap = model.valor_patrimonio(i, 80.0)
    js = pathlib.Path(__file__).resolve().parents[1] / "web" / "engine.js"
    code = f"""const M=require({json.dumps(str(js))}); const i={json.dumps(d)};
      console.log(JSON.stringify({{f:M.factorDescuento(i), v:M.valorRefinacion(i), banda:M.banda(i,{cap}), sens:M.sensibilidad(i,{cap})}}))"""
    out = json.loads(subprocess.check_output(["node", "-e", code]))
    assert abs(out["f"] - model.factor_descuento(i)) < 1e-9 and abs(out["v"] - model.valor_refinacion(i)) < 1e-6
    assert out["banda"] == model.banda(i, cap)
    py = {s["input"]: (s["menos10"], s["mas10"]) for s in model.sensibilidad(i, cap)}
    assert {s["input"]: (s["menos10"], s["mas10"]) for s in out["sens"]} == py and "ebitda_no_up_12m_musd" in py


def test_paridad_js():
    i = model.Inputs.desde_dict(SINTETICO)
    caps = [model.valor_patrimonio(i, b) for b in (45, 80, 130)]
    js = pathlib.Path(__file__).resolve().parents[1] / "web" / "engine.js"
    code = f"""const M=require({json.dumps(str(js))}); const i={json.dumps(SINTETICO)};
      console.log(JSON.stringify({{v:[45,80,130].map(b=>M.valorPatrimonio(i,b)), bi:{json.dumps(caps)}.map(c=>M.brentImplicito(i,c).valor),
      banda:M.banda(i,{caps[1]}), wacc:M.wacc(i)}}))"""
    out = json.loads(subprocess.check_output(["node", "-e", code]))
    for b, v in zip((45, 80, 130), out["v"]):
        assert abs(model.valor_patrimonio(i, b) - v) < 1e-6
    assert out["bi"] == [model.brent_implicito(i, c)["valor"] for c in caps]
    assert out["banda"] == model.banda(i, caps[1])
    assert abs(out["wacc"] - model.wacc(i)) < 1e-12


def test_recetas_compilan_y_numeros():
    import re
    from pipeline.recetas import RECETAS
    from pipeline.fetch_edgar import _num
    for emp, r in RECETAS.items():
        for campo, (doc, pats, rango) in r["campos"].items():
            for p in ([pats] if isinstance(pats, (str, tuple)) else pats):
                re.compile(p if isinstance(p, str) else p[0])
            assert doc in r["docs"], (emp, campo)
    assert _num("1,410.4") == 1410.4 and _num("(12)") == -12


def test_extraccion_sobre_texto():
    import re
    from pipeline.recetas import RECETAS
    t = ("Crude Oil and Condensate Volumes (MBbld) (1) United States 546.2 503.1 Trinidad 2.1 1.1 Other International (2) 0.5 — "
         "Total 548.8 504.2 Average Crude Oil and Condensate Prices ($/Bbl) (3) United States $ 98.18 $ 64.84 Composite 98.15 64.82")
    assert re.search(RECETAS["EOG"]["campos"]["crudo_kbd"][1], t).group(1) == "548.8"
    assert re.search(RECETAS["EOG"]["campos"]["p_crudo"][1], t).group(1) == "98.15"
