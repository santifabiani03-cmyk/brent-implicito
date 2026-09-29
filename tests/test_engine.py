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
