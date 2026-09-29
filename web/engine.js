// Réplica 1:1 de engine/model.py para correr en el navegador (inputs editables, modo proyección).
// tests/test_paridad.py verifica que ambos motores den lo mismo.
(function (root) {
  const HORIZONTE_MAX = 30;
  const CAMPOS = ["prod_crudo_kbd","prod_otros_kboed","precio_otros_usd_boe","diferencial_pct","regalias_pct",
    "retencion_pct","lifting_usd_boe","otros_costos_usd_boe","capex_musd_anual","dda_usd_boe","tasa_impuesto",
    "reservas_1p_mmboe","crecimiento_anual","anios_crecimiento","declino_anual","deuda_neta_musd",
    "minoritarios_musd","valor_no_upstream_musd","rf","beta","erp","crp","lambda_crp","kd","peso_deuda"];

  const wacc = i => { const ke = i.rf + i.beta * i.erp + i.lambda_crp * i.crp;
    return (1 - i.peso_deuda) * ke + i.peso_deuda * i.kd * (1 - i.tasa_impuesto); };

  function perfil(i) {
    const q1 = (i.prod_crudo_kbd + i.prod_otros_kboed) * 365 / 1000, out = []; let acc = 0;
    const g = Math.trunc(i.anios_crecimiento);
    for (let t = 1; t <= HORIZONTE_MAX; t++) {
      const q = q1 * Math.pow(1 + i.crecimiento_anual, Math.min(t - 1, g)) * Math.pow(1 - i.declino_anual, Math.max(0, t - 1 - g));
      if (acc + q >= i.reservas_1p_mmboe) { out.push(Math.max(0, i.reservas_1p_mmboe - acc)); break; }
      out.push(q); acc += q;
    }
    return out;
  }

  function valorPatrimonio(i, brent) {
    const r = wacc(i), share = i.prod_crudo_kbd / (i.prod_crudo_kbd + i.prod_otros_kboed);
    const qb1 = (i.prod_crudo_kbd + i.prod_otros_kboed) * 365 / 1000, capexBoe = qb1 ? i.capex_musd_anual / qb1 : 0;
    const pc = brent * (1 - i.diferencial_pct); let ev = 0;
    perfil(i).forEach((q, k) => { const t = k + 1, qc = q * share, qo = q * (1 - share), ic = qc * pc;
      const ing = ic + qo * i.precio_otros_usd_boe;
      const ebitda = ing * (1 - i.regalias_pct) - ic * i.retencion_pct - q * (i.lifting_usd_boe + i.otros_costos_usd_boe);
      const imp = i.tasa_impuesto * Math.max(0, ebitda - q * i.dda_usd_boe);
      ev += (ebitda - imp - q * capexBoe) / Math.pow(1 + r, t - 0.5); });
    return ev + i.valor_no_upstream_musd - i.deuda_neta_musd - i.minoritarios_musd;
  }

  function brentImplicito(i, cap, lo = 10, hi = 300, tol = 1e-4) {
    const f = b => valorPatrimonio(i, b) - cap;
    if (f(lo) > 0) return { valor: null, estado: "debajo", limite: lo };
    if (f(hi) < 0) return { valor: null, estado: "encima", limite: hi };
    if (valorPatrimonio(i, hi) <= valorPatrimonio(i, lo)) return { valor: null, estado: "no_monotono" };
    let a = lo, b = hi;
    while (b - a > tol) { const m = (a + b) / 2; if (f(m) > 0) b = m; else a = m; }
    return { valor: Math.round((a + b) / 2 * 100) / 100, estado: "ok" };
  }

  const BANDA = [["wacc_pp",-0.01],["wacc_pp",0.01],["diferencial_pct",-0.05],["diferencial_pct",0.05],["lifting_rel",-0.15],["lifting_rel",0.15]];
  function perturbar(i, k, d) { const x = { ...i };
    if (k === "wacc_pp") x.rf += d; else if (k === "lifting_rel") x.lifting_usd_boe *= 1 + d;
    else if (k.endsWith("_rel")) x[k.slice(0, -4)] *= 1 + d; else x[k] += d; return x; }
  function banda(i, cap) { const v = BANDA.map(([k, d]) => brentImplicito(perturbar(i, k, d), cap).valor).filter(x => x !== null);
    return v.length ? { min: Math.min(...v), max: Math.max(...v) } : { min: null, max: null }; }
  const SENSIBLES = ["diferencial_pct","lifting_usd_boe","capex_musd_anual","reservas_1p_mmboe","precio_otros_usd_boe","crp","beta","deuda_neta_musd"];
  function sensibilidad(i, cap, rel = 0.10) { const base = brentImplicito(i, cap).valor;
    return SENSIBLES.filter(k => i[k] !== 0).map(k => ({ input: k, base,
      menos10: brentImplicito(perturbar(i, k + "_rel", -rel), cap).valor, mas10: brentImplicito(perturbar(i, k + "_rel", rel), cap).valor }))
      .sort((a, b) => Math.abs((b.mas10 || 0) - (b.menos10 || 0)) - Math.abs((a.mas10 || 0) - (a.menos10 || 0))); }
  const precioObjetivo = (i, brent, acciones, ratio = 1, fx = 1) => valorPatrimonio(i, brent) / acciones * ratio * fx;

  root.MotorBrent = { CAMPOS, wacc, perfil, valorPatrimonio, brentImplicito, banda, sensibilidad, precioObjetivo };
  if (typeof module !== "undefined") module.exports = root.MotorBrent;
})(typeof window !== "undefined" ? window : globalThis);
