"""
Motor de valuación E&P y despeje del Brent implícito.

Cadena (ALCANCE §5):  Brent → precio de realización → ingreso → margen → flujo → valor
Despeje: se busca el Brent (constante en el tiempo, supuesto de ALCANCE §3) tal que
    valor del patrimonio del modelo == capitalización bursátil observada.

IMPORTANTE: este módulo NO trae parámetros por defecto con valores numéricos de empresas.
Todo input operativo viene de inputs/operativos.csv (cargado y citado por el equipo).
La misma lógica está replicada en web/engine.js; tests/test_paridad.py verifica que coincidan.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict

HORIZONTE_MAX = 30  # años

CAMPOS_REQUERIDOS = [
    "prod_crudo_kbd", "prod_otros_kboed", "precio_otros_usd_boe", "diferencial_pct",
    "regalias_pct", "retencion_pct", "lifting_usd_boe", "otros_costos_usd_boe",
    "capex_musd_anual", "dda_usd_boe", "tasa_impuesto", "reservas_1p_mmboe",
    "crecimiento_anual", "anios_crecimiento", "declino_anual",
    "deuda_neta_musd", "minoritarios_musd", "valor_no_upstream_musd",
    "rf", "beta", "erp", "crp", "lambda_crp", "kd", "peso_deuda",
]


@dataclass
class Inputs:
    prod_crudo_kbd: float          # producción de crudo, miles bbl/día (último trimestre)
    prod_otros_kboed: float        # gas + NGL, miles boe/día
    precio_otros_usd_boe: float    # precio de gas/NGL fijado como parámetro (no ligado al Brent)
    diferencial_pct: float         # descuento de realización del crudo vs Brent (0.08 = 8 %)
    regalias_pct: float            # sobre ingreso
    retencion_pct: float           # derechos de exportación efectivos sobre ingreso de crudo
    lifting_usd_boe: float
    otros_costos_usd_boe: float    # G&A, transporte, etc.
    capex_musd_anual: float        # capex anual (año 1), escala con la producción
    dda_usd_boe: float             # amortización fiscal por boe
    tasa_impuesto: float
    reservas_1p_mmboe: float       # acota el horizonte
    crecimiento_anual: float
    anios_crecimiento: int
    declino_anual: float
    deuda_neta_musd: float
    minoritarios_musd: float
    valor_no_upstream_musd: float  # downstream/otros segmentos (integradas); 0 en pure-plays
    rf: float
    beta: float
    erp: float
    crp: float                     # prima de riesgo país (diferencial soberano)
    lambda_crp: float              # exposición al riesgo país (1 = caso base, ver MT 7.2.2)
    kd: float
    peso_deuda: float              # D/(D+E)

    @classmethod
    def desde_dict(cls, d: dict) -> "Inputs":
        faltan = [c for c in CAMPOS_REQUERIDOS if d.get(c) in (None, "")]
        if faltan:
            raise ValueError(f"Faltan inputs: {', '.join(faltan)}")
        vals = {c: float(d[c]) for c in CAMPOS_REQUERIDOS}
        vals["anios_crecimiento"] = int(vals["anios_crecimiento"])
        return cls(**vals)


def wacc(i: Inputs) -> float:
    ke = i.rf + i.beta * i.erp + i.lambda_crp * i.crp
    return (1 - i.peso_deuda) * ke + i.peso_deuda * i.kd * (1 - i.tasa_impuesto)


def perfil_produccion(i: Inputs) -> list[float]:
    """Producción anual total (MMboe) por año, truncada por reservas probadas."""
    q1 = (i.prod_crudo_kbd + i.prod_otros_kboed) * 365 / 1000
    perfil, acumulado = [], 0.0
    for t in range(1, HORIZONTE_MAX + 1):
        f = (1 + i.crecimiento_anual) ** min(t - 1, i.anios_crecimiento) \
            * (1 - i.declino_anual) ** max(0, t - 1 - i.anios_crecimiento)
        q = q1 * f
        if acumulado + q >= i.reservas_1p_mmboe:
            perfil.append(max(0.0, i.reservas_1p_mmboe - acumulado))
            break
        perfil.append(q)
        acumulado += q
    return perfil


def valor_patrimonio(i: Inputs, brent: float) -> float:
    """Valor del patrimonio (MUSD) para un Brent constante."""
    r = wacc(i)
    share_crudo = i.prod_crudo_kbd / (i.prod_crudo_kbd + i.prod_otros_kboed)
    q_boe1 = (i.prod_crudo_kbd + i.prod_otros_kboed) * 365 / 1000
    capex_boe = i.capex_musd_anual / q_boe1 if q_boe1 else 0.0
    p_crudo = brent * (1 - i.diferencial_pct)
    ev = 0.0
    for t, q in enumerate(perfil_produccion(i), start=1):
        q_c, q_o = q * share_crudo, q * (1 - share_crudo)
        ing_crudo = q_c * p_crudo
        ingreso = ing_crudo + q_o * i.precio_otros_usd_boe
        ebitda = ingreso * (1 - i.regalias_pct) - ing_crudo * i.retencion_pct \
            - q * (i.lifting_usd_boe + i.otros_costos_usd_boe)
        impuesto = i.tasa_impuesto * max(0.0, ebitda - q * i.dda_usd_boe)
        fcf = ebitda - impuesto - q * capex_boe
        ev += fcf / (1 + r) ** (t - 0.5)
    return ev + i.valor_no_upstream_musd - i.deuda_neta_musd - i.minoritarios_musd


def brent_implicito(i: Inputs, cap_mercado_musd: float, lo: float = 10.0, hi: float = 300.0,
                    tol: float = 1e-4) -> dict:
    """Despeje por bisección. Devuelve {'valor', 'estado'}; estado ∈ ok|debajo|encima|no_monotono."""
    f = lambda b: valor_patrimonio(i, b) - cap_mercado_musd
    flo, fhi = f(lo), f(hi)
    if flo > 0:
        return {"valor": None, "estado": "debajo", "limite": lo}
    if fhi < 0:
        return {"valor": None, "estado": "encima", "limite": hi}
    if valor_patrimonio(i, hi) <= valor_patrimonio(i, lo):
        return {"valor": None, "estado": "no_monotono"}
    a, b = lo, hi
    while b - a > tol:
        m = (a + b) / 2
        if f(m) > 0:
            b = m
        else:
            a = m
    return {"valor": round((a + b) / 2, 2), "estado": "ok"}


# Escenarios para la banda (provisorio: a reemplazar por el método que defina Metodología)
BANDA = [("wacc_pp", -0.01), ("wacc_pp", 0.01), ("diferencial_pct", -0.05), ("diferencial_pct", 0.05),
         ("lifting_rel", -0.15), ("lifting_rel", 0.15)]


def _perturbar(i: Inputs, clave: str, delta: float) -> Inputs:
    d = asdict(i)
    if clave == "wacc_pp":
        d["rf"] += delta          # desplaza el WACC ~1 a 1 vía costo del capital propio
    elif clave == "lifting_rel":
        d["lifting_usd_boe"] *= 1 + delta
    elif clave.endswith("_rel"):
        d[clave[:-4]] *= 1 + delta
    else:
        d[clave] += delta
    return Inputs(**d)


def banda(i: Inputs, cap: float) -> dict:
    vals = [brent_implicito(_perturbar(i, k, dv), cap)["valor"] for k, dv in BANDA]
    vals = [v for v in vals if v is not None]
    return {"min": min(vals), "max": max(vals)} if vals else {"min": None, "max": None}


SENSIBLES = ["diferencial_pct", "lifting_usd_boe", "capex_musd_anual", "reservas_1p_mmboe",
             "precio_otros_usd_boe", "crp", "beta", "deuda_neta_musd"]


def sensibilidad(i: Inputs, cap: float, rel: float = 0.10) -> list[dict]:
    base = brent_implicito(i, cap)["valor"]
    out = []
    for k in SENSIBLES:
        if getattr(i, k) == 0:
            continue
        lo = brent_implicito(_perturbar(i, k + "_rel", -rel), cap)["valor"]
        hi = brent_implicito(_perturbar(i, k + "_rel", rel), cap)["valor"]
        out.append({"input": k, "menos10": lo, "mas10": hi, "base": base})
    return sorted(out, key=lambda x: -abs((x["mas10"] or 0) - (x["menos10"] or 0)))


def precio_objetivo(i: Inputs, brent: float, acciones_mm: float, ratio_adr: float = 1.0,
                    fx: float = 1.0) -> float:
    """Modo proyección: precio por unidad cotizada (ADR o acción) en moneda de cotización."""
    return valor_patrimonio(i, brent) / acciones_mm * ratio_adr * fx
