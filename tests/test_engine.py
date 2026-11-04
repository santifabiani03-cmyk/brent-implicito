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
