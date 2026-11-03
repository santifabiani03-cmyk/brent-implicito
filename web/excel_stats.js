/* Test de la hipótesis del TIF (6.1): regreso de los desvíos amplios de la prima y referencia simulada sin reversión.
   Lo usa la descarga a Excel: las fórmulas de la hoja Consistencia dan lo mismo que evaluar() (valores en caché y control);
   la referencia simulada no se puede expresar con fórmulas y queda como columnas en la hoja Simulación. */
(function () {
  const VENTANA = 20;

  // forma cerrada del motor (engine/model.py) con perfil plano: V = A·P + B, o A0·P + B0 si la base imponible es negativa
  function coef(x) {
    const r = (1 - x.peso_deuda) * (x.rf + x.beta * x.erp + x.lambda_crp * x.crp) + x.peso_deuda * x.kd * (1 - x.tasa_impuesto);
    const Q = (x.prod_crudo_kbd + x.prod_otros_kboed) * 365 / 1000, sh = x.prod_crudo_kbd / (x.prod_crudo_kbd + x.prod_otros_kboed);
    const nf = Math.floor(x.reservas_1p_mmboe / Q), n = Math.min(nf, 30), rem = nf >= 30 ? 0 : x.reservas_1p_mmboe - n * Q;
    const V = Q * Math.pow(1 + r, 0.5) * (1 - Math.pow(1 + r, -n)) / r + rem * Math.pow(1 + r, -(n + 0.5));
    const t = x.tasa_impuesto, a = sh * (1 - x.diferencial_pct) * ((1 - x.regalias_pct) - x.retencion_pct);
    const m = (1 - sh) * x.precio_otros_usd_boe * (1 - x.regalias_pct) - x.lifting_usd_boe - x.otros_costos_usd_boe;
    const cb = x.capex_musd_anual / Q, aj = x.valor_no_upstream_musd - x.deuda_neta_musd - x.minoritarios_musd;
    return { r, Q, sh, n, rem, V, a, m, cb, aj, A: V * a * (1 - t), B: V * (m * (1 - t) + t * x.dda_usd_boe - cb) + aj,
      A0: V * a, B0: V * (m - cb) + aj, pk: (x.dda_usd_boe - m) / a };
  }
  const despeje = (k, cap) => { const p = (cap - k.B) / k.A; return p < k.pk ? (cap - k.B0) / k.A0 : p; };

  /* Serie de una empresa en ruedas (días con acción y CO1), con 20 ruedas antes del rango (ventana) y 15 después (evaluación). */
  function preparar(D, id, desde, hasta) {
    const hi = D.historia, s = hi.series[id];
    const co1 = Object.fromEntries(hi.brent_1l.fecha.map((f, i) => [f, hi.brent_1l.valor[i]]));
    const todas = s.fecha.map((f, i) => i).filter(i => co1[s.fecha[i]] != null && s.cap_musd[i] != null);
    const a = todas.findIndex(i => s.fecha[i] >= desde);
    let b = todas.length - 1; while (b >= 0 && s.fecha[todas[b]] > hasta) b--;
    if (a < 0 || b < a) return null;
    const ini = Math.max(0, a - VENTANA), fin = Math.min(todas.length - 1, b + 15), idx = todas.slice(ini, fin + 1);
    const bal = idx.map(i => s.periodos[s.cal_idx[i]]);
    const usados = [...new Set(bal)];
    const cals = hi.calibraciones[id].filter(k => usados.includes(k.periodo) && !k.faltan.length)
      .map(k => ({ ...k, _k: coef(Object.fromEntries(Object.entries(k.inputs).map(([n, v]) => [n, v[0]]))) }));
    const posK = Object.fromEntries(cals.map((k, i) => [k.periodo, i]));
    const e = { id, fechas: idx.map(i => s.fecha[i]), co1: idx.map(i => co1[s.fecha[i]]), cap: idx.map(i => s.cap_musd[i]),
      web: idx.map(i => s.implicito[i]), bal, kIdx: bal.map(p => posK[p]), cals, i0: a - ini, i1: b - ini };
    e.n = e.fechas.length;
    e.primero = cals.map((_, k) => e.kIdx.indexOf(k));
    e.ultimo = cals.map((_, k) => e.kIdx.lastIndexOf(k));
    return e;
  }
  const impK = (e, k) => e._imp?.[k] || ((e._imp = e._imp || [])[k] = e.cap.map(c => despeje(e.cals[k]._k, c)));
  const primaK = (e, k) => e._pr?.[k] || ((e._pr = e._pr || [])[k] = impK(e, k).map((v, j) => v - e.co1[j]));
  function rangoK(e, k) {           // media y desvío muestral de las 20 ruedas previas, con los parámetros del balance k
    if (e._ra?.[k]) return e._ra[k];
    const p = primaK(e, k), m = new Array(e.n).fill(null), s = new Array(e.n).fill(null);
    for (let t = VENTANA; t < e.n; t++) {
      let sum = 0; for (let j = t - VENTANA; j < t; j++) sum += p[j];
      const me = sum / VENTANA; let v = 0; for (let j = t - VENTANA; j < t; j++) v += (p[j] - me) ** 2;
      m[t] = me; s[t] = Math.sqrt(v / (VENTANA - 1));
    }
    return ((e._ra = e._ra || [])[k] = { m, s });
  }

  /* Regla de 6.1 sobre una empresa. cfg: z (desvíos), plazo (ruedas), rec (recorrido mínimo), reset (reinicia la ventana con cada balance). */
  function evaluar(e, cfg) {
    const { z, plazo, rec, reset } = cfg, fuera = new Array(e.n).fill(0), casos = [];
    for (let t = VENTANA; t < e.n; t++) {
      const k = e.kIdx[t]; if (reset && t - VENTANA < e.primero[k]) continue;
      const { m, s } = rangoK(e, k), p = primaK(e, k)[t];
      if (p > m[t] + z * s[t] || p < m[t] - z * s[t]) fuera[t] = 1;
    }
    for (let t = Math.max(e.i0, 1); t <= e.i1; t++) {
      if (!fuera[t] || fuera[t - 1]) continue;
      const k = e.kIdx[t], { m, s } = rangoK(e, k), P = primaK(e, k), d0 = P[t] - m[t], sg = Math.sign(d0);
      let h = null;
      for (let i = t + 1; i <= Math.min(t + plazo, e.n - 1); i++)
        if (sg * (P[i] - m[i]) <= z * s[i] && sg * (P[t] - P[i]) >= rec * Math.abs(d0)) { h = i - t; break; }
      const censurado = h == null && t + plazo > e.n - 1;
      casos.push({ t, k, d0, sg, h, reg: censurado ? null : (h != null ? 1 : 0), cruza: e.kIdx[Math.min(t + plazo, e.n - 1)] !== k ? 1 : 0 });
    }
    return { casos, fuera };
  }

  const media = a => a.reduce((x, y) => x + y, 0) / a.length;
  const devsq = a => { const m = media(a); return a.reduce((x, y) => x + (y - m) ** 2, 0); };
  const cov = (a, b) => { const ma = media(a), mb = media(b); return a.reduce((x, y, i) => x + (y - ma) * (b[i] - mb), 0) / (a.length - 1); };

  /* Calibra la referencia: cambio diario del implícito (mismo balance) = β·ΔCO1 + u; u se remuestrea por fecha, conjunto entre empresas
     (conserva volatilidad y correlación, sin autocorrelación: no hay reversión). El ruido de cierre (desfase remanente) es
     σε² = −cov(u_t, u_t−1), sin ruido si la covarianza es positiva; se agrega como error i.i.d. sobre el nivel. */
  function calibrar(emps) {
    const porFecha = {};
    emps.forEach(e => {
      const du = [], dc = [], fs = [];
      for (let t = 1; t < e.n; t++) { const imp = impK(e, e.kIdx[t]); du.push(imp[t] - imp[t - 1]); dc.push(e.co1[t] - e.co1[t - 1]); fs.push(e.fechas[t]); }
      const beta = cov(du, dc) / (devsq(dc) / (dc.length - 1));
      const u0 = du.map((v, i) => v - beta * dc[i]), mu = media(u0), u = u0.map(v => v - mu);
      const v = devsq(u) / (u.length - 1), c1 = cov(u.slice(1), u.slice(0, -1)), ve = Math.min(Math.max(0, -c1), 0.45 * v);
      e.sim = { beta, volU: Math.sqrt(v), sigEps: Math.sqrt(ve), escala: Math.sqrt((v - 2 * ve) / v), ac1: c1 / v };
      fs.forEach((f, i) => { (porFecha[f] = porFecha[f] || {})[e.id] = u[i]; });
    });
    const conjuntas = Object.values(porFecha).filter(o => emps.every(e => o[e.id] != null));
    const calendario = [...new Set(emps.flatMap(e => e.fechas))].sort(), posF = Object.fromEntries(calendario.map((f, i) => [f, i]));
    emps.forEach(e => { e.cal = e.fechas.map(f => posF[f]); e.dco1 = e.co1.map((c, t) => t ? c - e.co1[t - 1] : 0); });
    return { pool: emps.map(e => Float64Array.from(conjuntas.map(o => o[e.id]))), nPool: conjuntas.length, nCal: calendario.length };
  }
  function rng32(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  /* Una corrida por empresa: misma regla que evaluar(), sobre una prima simulada sin balances (los parámetros no saltan). */
  function reglaSim(e, P, cfg) {
    const { z, plazo, rec, reset } = cfg, n = e.n, m = new Float64Array(n), s = new Float64Array(n), fuera = new Uint8Array(n);
    let sum = 0, sq = 0;
    for (let t = 0; t < n; t++) {
      if (t >= VENTANA) {
        const me = sum / VENTANA, sd = Math.sqrt(Math.max(0, (sq - VENTANA * me * me) / (VENTANA - 1)));
        m[t] = me; s[t] = sd;
        if (!(reset && t - VENTANA < e.primero[e.kIdx[t]]) && (P[t] > me + z * sd || P[t] < me - z * sd)) fuera[t] = 1;
        sum -= P[t - VENTANA]; sq -= P[t - VENTANA] * P[t - VENTANA];
      }
      sum += P[t]; sq += P[t] * P[t];
    }
    let casos = 0, reg = 0;
    for (let t = Math.max(e.i0, 1); t <= e.i1; t++) {
      if (!fuera[t] || fuera[t - 1]) continue;
      const d0 = P[t] - m[t], sg = Math.sign(d0); let ok = false;
      for (let i = t + 1; i <= Math.min(t + plazo, n - 1); i++)
        if (sg * (P[i] - m[i]) <= z * s[i] && sg * (P[t] - P[i]) >= rec * Math.abs(d0)) { ok = true; break; }
      if (ok) { casos++; reg++; } else if (t + plazo <= n - 1) casos++;
    }
    return [casos, reg];
  }

  /* N corridas. Devuelve para cada corrida [casos, regresos] por empresa (mismo orden que emps). */
  async function simular(emps, base, cfg, N, seed, sigue) {
    const rnd = rng32(seed), res = [], P = emps.map(e => new Float64Array(e.n));
    const normal = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
    const ini = emps.map(e => impK(e, e.kIdx[0])[0]), draw = new Int32Array(base.nCal);
    for (let c = 0; c < N; c++) {
      for (let i = 0; i < base.nCal; i++) draw[i] = Math.floor(rnd() * base.nPool);
      res.push(emps.map((e, j) => {
        let rw = ini[j]; const u = base.pool[j], S = e.sim, p = P[j];
        for (let t = 0; t < e.n; t++) {
          if (t) rw += S.beta * e.dco1[t] + S.escala * u[draw[e.cal[t]]];
          p[t] = rw + (S.sigEps ? S.sigEps * normal() : 0) - e.co1[t];
        }
        return reglaSim(e, p, cfg);
      }));
      if (c % 100 === 99) { if (sigue && !sigue()) return null; await new Promise(r => setTimeout(r)); }
    }
    return res;
  }
  /* Grupos del objetivo c): cada empresa, regiones, estructuras y total. */
  function grupos(emps, D) {
    const info = Object.fromEntries(D.empresas.map(e => [e.id, e])), ids = emps.map(e => e.id), g = ids.map(i => ({ nombre: i, ids: [i] }));
    const reg = [...new Set(ids.map(i => info[i].region))], est = [...new Set(ids.map(i => info[i].perfil))];
    reg.forEach(r => g.push({ nombre: r, ids: ids.filter(i => info[i].region === r), tipo: "region" }));
    est.forEach(p => g.push({ nombre: p === "integrada" ? "Integradas" : "Perfil puro", ids: ids.filter(i => info[i].perfil === p), tipo: "estructura" }));
    g.push({ nombre: "Total", ids, tipo: "total" });
    return g;
  }
  const propSim = (corrida, emps, ids) => { let c = 0, r = 0; emps.forEach((e, j) => { if (ids.includes(e.id)) { c += corrida[j][0]; r += corrida[j][1]; } }); return c ? r / c : null; };
  function percentil(a, q) {  // igual que PERCENTILE de Excel
    const s = a.filter(v => v != null).sort((x, y) => x - y); if (!s.length) return null;
    const p = q * (s.length - 1), f = Math.floor(p); return s[f] + (p - f) * ((s[f + 1] ?? s[f]) - s[f]);
  }
  const corr = (x, y) => cov(x, y) / Math.sqrt(devsq(x) / (x.length - 1) * devsq(y) / (y.length - 1));
  const sd = a => Math.sqrt(devsq(a) / (a.length - 1));

  // Especificación principal y sensibilidades de 8.3. Misma semilla en la página y en el Excel: dan los mismos números.
  const PRINCIPAL = { z: 2, plazo: 10, rec: .5 }, NSIM = 2000, NSENS = 1000, SEMILLA = 20261103, MIN_RUEDAS = 40;
  const ESCENARIOS = [["Especificación principal (±2 desvíos, 10 ruedas, ½ d0)", PRINCIPAL], ["Banda de ±1,5 desvíos", { ...PRINCIPAL, z: 1.5 }], ["Banda de ±2,5 desvíos", { ...PRINCIPAL, z: 2.5 }],
    ["Plazo de 5 ruedas", { ...PRINCIPAL, plazo: 5 }], ["Plazo de 15 ruedas", { ...PRINCIPAL, plazo: 15 }], ["Recorrido mínimo de ⅓ d0", { ...PRINCIPAL, rec: 1 / 3 }],
    ["Recorrido mínimo de ⅔ d0", { ...PRINCIPAL, rec: 2 / 3 }], ["Ventana que reinicia con cada balance", { ...PRINCIPAL, reset: true }]];
  async function sensibilidades(emps, base, avance, sigue) {
    const ids = emps.map(e => e.id), out = [];
    for (let i = 0; i < ESCENARIOS.length; i++) {
      if (avance) avance(i + 1, ESCENARIOS.length);
      const [nombre, cfg] = ESCENARIOS[i]; let cas = 0, reg = 0, cen = 0;
      emps.forEach(e => { const c = evaluar(e, cfg).casos; cas += c.length; reg += c.filter(x => x.reg === 1).length; cen += c.filter(x => x.reg === null).length; });
      const r = await simular(emps, base, cfg, NSENS, SEMILLA + i + 1, sigue);
      if (!r) return null;
      out.push({ nombre, cas, reg, cen, prop: reg / (cas - cen), sim: r.map(c => propSim(c, emps, ids)).filter(v => v != null) });
    }
    return out;
  }
  // Resultado observado de un grupo de empresas, con e.ev = evaluar(e, PRINCIPAL)
  function observado(emps, ids) {
    const c = emps.filter(e => ids.includes(e.id)).flatMap(e => e.ev.casos), reg = c.filter(x => x.reg === 1).length, no = c.filter(x => x.reg === 0).length, cen = c.filter(x => x.reg === null).length;
    const sc = c.filter(x => !x.cruza && x.reg !== null), rc = c.filter(x => x.reg === 1 && x.h);
    return { n: c.length, reg, no, cen, prop: reg + no ? reg / (reg + no) : null, h: rc.length ? media(rc.map(x => x.h)) : null, d0: c.length ? media(c.map(x => Math.abs(x.d0))) : null,
      cruza: c.filter(x => x.cruza).length, propSc: sc.length ? sc.filter(x => x.reg === 1).length / sc.length : null, nSc: sc.length, regSc: sc.filter(x => x.reg === 1).length };
  }
  // Dinámica de la prima con un mismo balance (panel D): AR(1), vida media, ruido de cierre y forma de los cambios diarios
  function dinamica(e) {
    const d = [], l = [], dl = [], dd = [], fue = [];
    for (let t = e.i0; t <= e.i1; t++) {
      if (t < 1) continue;
      const P = primaK(e, e.kIdx[t]); d.push(P[t] - P[t - 1]); l.push(P[t - 1]);
      if (t - 1 >= e.i0 && t - 1 >= 1) { const Q = primaK(e, e.kIdx[t - 1]); dl.push(Q[t - 1] - Q[t - 2]); dd.push(P[t] - P[t - 1]); }
      if (t >= VENTANA) fue.push(e.ev.fuera[t]);
    }
    const b = cov(d, l) / (devsq(l) / (l.length - 1)), a0 = media(d) - b * media(l), res = d.map((v, i) => v - a0 - b * l[i]), se = Math.sqrt(res.reduce((x, y) => x + y * y, 0) / (d.length - 2)) / Math.sqrt(devsq(l));
    const md = media(d), sdd = sd(d), n = d.length, skew = n / ((n - 1) * (n - 2)) * d.reduce((x, y) => x + ((y - md) / sdd) ** 3, 0), kurt = n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * d.reduce((x, y) => x + ((y - md) / sdd) ** 4, 0) - 3 * (n - 1) ** 2 / ((n - 2) * (n - 3));
    const rho = 1 + b;
    return { b, se, rho, t: b / se, vida: rho > 0 && rho < 1 ? Math.log(.5) / Math.log(rho) : null, ac: corr(dd, dl), ruido: Math.sqrt(Math.max(0, -cov(dd, dl) * (dd.length - 1) / dd.length)), fue: media(fue), skew, kurt, sdd };
  }
  window.BIStats = { VENTANA, PRINCIPAL, NSIM, NSENS, SEMILLA, MIN_RUEDAS, ESCENARIOS, coef, despeje, preparar, primaK, rangoK, impK, evaluar, calibrar, simular, sensibilidades, observado, dinamica, grupos, propSim, percentil, media, devsq, cov, corr, sd };
})();
