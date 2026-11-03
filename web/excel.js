/* Descarga a Excel: dashboard con gráficos conectados a celdas, prueba estadística de la hipótesis (hoja Consistencia),
   una hoja por empresa con los insumos de cada balance y el despeje con fórmulas, Implícitos diarios con el CO1 y hojas de cálculo.
   El despeje usa la forma cerrada del motor (engine/model.py):
     valor del patrimonio = A·P + B  si la base imponible por boe es ≥ 0 (P ≥ Pk)
                          = A0·P + B0 si no (tramo sin impuesto)
   que coincide con la bisección del motor (tolerancia 0,005 USD/bbl) mientras el perfil de producción sea plano. */
(function () {
  const EXCELJS = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
  const ORDEN = ["prod_crudo_kbd", "prod_otros_kboed", "precio_otros_usd_boe", "diferencial_pct", "regalias_pct", "retencion_pct",
    "lifting_usd_boe", "otros_costos_usd_boe", "capex_musd_anual", "dda_usd_boe", "tasa_impuesto", "reservas_1p_mmboe",
    "crecimiento_anual", "anios_crecimiento", "declino_anual", "deuda_neta_musd", "minoritarios_musd", "valor_no_upstream_musd",
    "rf", "beta", "erp", "crp", "lambda_crp", "kd", "peso_deuda"];
  const ORIGEN = { edgar: "EDGAR", bloomberg: "Bloomberg", automatico: "Automático", derivado: "Calculado", macro: "Mercado",
    semilla: "Reporte citado", supuesto: "Supuesto", parametro: "Parámetro", equipo: "Equipo", arrastrado: "Arrastrado" };
  const F0 = 6;                                     // fila del primer insumo en las hojas de empresa
  const R_ = Object.fromEntries(ORDEN.map((k, i) => [k, F0 + i]));
  const C = { wacc: 33, q: 34, sh: 35, n: 36, rem: 37, v: 38, a: 39, m: 40, cb: 41, aj: 42, A: 43, B: 44, A0: 45, B0: 46, pk: 47, plano: 48 };
  const HEAD = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A4D" } } };
  const SUB = { font: { bold: true }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF2" } } };
  const GRIS = { font: { italic: true, color: { argb: "FF555555" } } };
  const COLORES = { VIST: "1F77B4", YPF: "D9730D", EOG: "2E8B57", SU: "C8A415", PRIO: "C2185B", PBR: "6A3FA0" };
  const CFG = { z: "Consistencia!$C$7", plazo: "Consistencia!$C$8", rec: "Consistencia!$C$9", pct: "Consistencia!$C$10" };
  const X0 = 24;      // primera columna (1-based) de la matriz prima/media/desvío por balance en las hojas Rango

  let cargando = null;
  function libreria() {
    if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
    return cargando || (cargando = new Promise((ok, mal) => {
      const s = document.createElement("script"); s.src = EXCELJS; s.async = true;
      s.onload = () => ok(window.ExcelJS); s.onerror = () => { cargando = null; mal(new Error("no se pudo cargar ExcelJS (¿sin conexión?)")); };
      document.head.appendChild(s);
    }));
  }
  const col = n => { let s = ""; for (n++; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
  const fechaXL = f => new Date(f + "T00:00:00Z");
  const fx = (formula, result) => ({ formula, result: result === undefined || result === null || Number.isNaN(result) ? undefined : result });

  function hojaEmpresa(wb, e, cals, CAMPOS) {
    const ws = wb.addWorksheet(e.id, { views: [{ state: "frozen", xSplit: 2, ySplit: 4 }] });
    ws.getColumn(1).width = 44; ws.getColumn(2).width = 11;
    ws.getCell("A1").value = `${e.id} — ${e.nombre}: insumos de cada balance y despeje del Brent implícito`;
    ws.getCell("A1").font = { bold: true, size: 13 };
    ws.getCell("A2").value = "Una columna por balance (trimestre). Los insumos se pueden editar: el cálculo de abajo, la hoja Implícitos, Consistencia y el Dashboard se recalculan solos.";
    Object.assign(ws.getCell("A2"), GRIS);
    ws.getRow(4).values = ["Variable", "Unidad", ...cals.map(k => k.periodo)];
    ws.getRow(5).values = ["Publicado (rige desde)", "fecha", ...cals.map(k => fechaXL(k.publicado))];
    ws.getRow(4).eachCell(c => Object.assign(c, HEAD));
    ws.getRow(5).eachCell((c, i) => { if (i > 2) c.numFmt = "dd/mm/yyyy"; });
    ORDEN.forEach((k, i) => {
      const fila = ws.getRow(F0 + i), pct = (CAMPOS[k] || [])[1]?.startsWith("%");
      fila.getCell(1).value = (CAMPOS[k] || [k])[0]; fila.getCell(2).value = (CAMPOS[k] || [k, ""])[1];
      cals.forEach((cal, j) => { const c = fila.getCell(3 + j); const v = cal.inputs[k]; c.value = v ? v[0] : null; c.numFmt = pct ? "0.00%" : "#,##0.00"; });
    });
    ws.getCell(`A${C.wacc - 1}`).value = "Cálculo (fórmulas sobre los insumos de arriba)"; Object.assign(ws.getCell(`A${C.wacc - 1}`), SUB);
    const R = R_;
    const filas = [
      [C.wacc, "WACC", "%", c => `(1-${c}${R.peso_deuda})*(${c}${R.rf}+${c}${R.beta}*${c}${R.erp}+${c}${R.lambda_crp}*${c}${R.crp})+${c}${R.peso_deuda}*${c}${R.kd}*(1-${c}${R.tasa_impuesto})`, "r", "0.00%"],
      [C.q, "Producción anual (crudo + otros)", "MMboe", c => `(${c}${R.prod_crudo_kbd}+${c}${R.prod_otros_kboed})*365/1000`, "Q"],
      [C.sh, "Participación del crudo", "%", c => `${c}${R.prod_crudo_kbd}/(${c}${R.prod_crudo_kbd}+${c}${R.prod_otros_kboed})`, "sh", "0.0%"],
      [C.n, "Años completos de producción (R/P, máx. 30)", "años", c => `MIN(INT(${c}${R.reservas_1p_mmboe}/${c}${C.q}),30)`, "n", "0"],
      [C.rem, "Producción del último año parcial", "MMboe", c => `IF(INT(${c}${R.reservas_1p_mmboe}/${c}${C.q})>=30,0,${c}${R.reservas_1p_mmboe}-${c}${C.n}*${c}${C.q})`, "rem"],
      [C.v, "Volumen descontado (Σ q·(1+r)^-(t-0,5))", "MMboe", c => `${c}${C.q}*(1+${c}${C.wacc})^0.5*(1-(1+${c}${C.wacc})^(-${c}${C.n}))/${c}${C.wacc}+${c}${C.rem}*(1+${c}${C.wacc})^(-(${c}${C.n}+0.5))`, "V"],
      [C.a, "a: margen por USD de Brent, por boe", "—", c => `${c}${C.sh}*(1-${c}${R.diferencial_pct})*((1-${c}${R.regalias_pct})-${c}${R.retencion_pct})`, "a", "0.0000"],
      [C.m, "m: margen sin crudo por boe (otros × (1−regalías) − costos)", "USD/boe", c => `(1-${c}${C.sh})*${c}${R.precio_otros_usd_boe}*(1-${c}${R.regalias_pct})-${c}${R.lifting_usd_boe}-${c}${R.otros_costos_usd_boe}`, "m"],
      [C.cb, "Capex por boe", "USD/boe", c => `${c}${R.capex_musd_anual}/${c}${C.q}`, "cb"],
      [C.aj, "No-upstream − deuda neta − minoritarios", "MUSD", c => `${c}${R.valor_no_upstream_musd}-${c}${R.deuda_neta_musd}-${c}${R.minoritarios_musd}`, "aj"],
      [C.A, "A: sensibilidad del patrimonio al Brent (con impuesto)", "MUSD por USD/bbl", c => `${c}${C.v}*${c}${C.a}*(1-${c}${R.tasa_impuesto})`, "A"],
      [C.B, "B: resto del valor (con impuesto)", "MUSD", c => `${c}${C.v}*(${c}${C.m}*(1-${c}${R.tasa_impuesto})+${c}${R.tasa_impuesto}*${c}${R.dda_usd_boe}-${c}${C.cb})+${c}${C.aj}`, "B"],
      [C.A0, "A0: sensibilidad sin impuesto (base imponible < 0)", "MUSD por USD/bbl", c => `${c}${C.v}*${c}${C.a}`, "A0"],
      [C.B0, "B0: resto del valor sin impuesto", "MUSD", c => `${c}${C.v}*(${c}${C.m}-${c}${C.cb})+${c}${C.aj}`, "B0"],
      [C.pk, "Pk: Brent con base imponible cero (debajo, sin impuesto)", "USD/bbl", c => `(${c}${R.dda_usd_boe}-${c}${C.m})/${c}${C.a}`, "pk"],
    ];
    filas.forEach(([f, lab, u, fm, clave, nf]) => {
      const fila = ws.getRow(f); fila.getCell(1).value = lab; fila.getCell(2).value = u;
      cals.forEach((cal, j) => { const c = col(2 + j); const cell = fila.getCell(3 + j);
        cell.value = fx(fm(c), cal._k ? cal._k[clave] : undefined); cell.numFmt = nf || "#,##0.00"; });
    });
    const fp = ws.getRow(C.plano); fp.getCell(1).value = "Perfil de producción plano (la forma cerrada vale)"; fp.getCell(2).value = "control";
    cals.forEach((cal, j) => { const c = col(2 + j);
      fp.getCell(3 + j).value = fx(`IF(AND(${c}${R.crecimiento_anual}=0,${c}${R.declino_anual}=0),"OK","no plano: usar la web")`, "OK"); });
    const o0 = C.plano + 2;
    ws.getCell(`A${o0}`).value = "Origen de cada dato"; Object.assign(ws.getCell(`A${o0}`), SUB);
    ORDEN.forEach((k, i) => { const fila = ws.getRow(o0 + 1 + i); fila.getCell(1).value = (CAMPOS[k] || [k])[0];
      cals.forEach((cal, j) => { const v = cal.inputs[k]; fila.getCell(3 + j).value = v ? (ORIGEN[v[1]] || v[1]) : "—"; }); });
    for (let j = 0; j < cals.length; j++) ws.getColumn(3 + j).width = 13;
  }

  /* Hoja de cálculo del rango habitual: todo con fórmulas sobre la hoja de la empresa. */
  function hojaRango(wb, e, ev, cfg) {
    const ws = wb.addWorksheet("Rango " + e.id, { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
    const K = e.cals.length, n = e.n, f0 = 5, S = window.BIStats;
    const lastCol = col(X0 - 1 + 3 * K - 1), MAT = `$${col(X0 - 1)}$${f0}:$${lastCol}$${f0 + n - 1}`;
    ws.getCell("A1").value = `${e.id}: rango habitual y casos (6.1). Fórmulas conectadas a la hoja ${e.id} y a los parámetros de Consistencia.`; ws.getCell("A1").font = { bold: true, size: 12 };
    ws.getCell("A2").value = "A la derecha, prima/media/desvío con los parámetros de cada balance: la ventana (20 ruedas previas) se recalcula con el balance vigente y cada caso se evalúa con el del día del desvío.";
    Object.assign(ws.getCell("A2"), GRIS);
    const cab = ["Fecha", "CO1", "Cap. (MUSD)", "Balance", "n.º bal.", "Prima", "Media 20", "Desvío 20", "Inferior", "Superior", "Fuera", "Inicio caso", "d0", "Signo", "Fin eval.", "Ruedas que cumplen", "Regresó", "Ruedas hasta regreso", "Cruza balance", "Δ prima (mismo bal.)", "Prima t−1", "Δ prima t−1", "Marca caso"];
    e.cals.forEach(k => cab.push(`Prima|${k.periodo}`, `Media|${k.periodo}`, `Desvío|${k.periodo}`));
    ws.getRow(4).values = cab; ws.getRow(4).eachCell(c => Object.assign(c, HEAD)); ws.getRow(4).alignment = { wrapText: true, vertical: "middle" }; ws.getRow(4).height = 42;
    ws.getColumn(1).width = 11; ws.getColumn(4).width = 11;
    const porT = Object.fromEntries(ev.casos.map(c => [c.t, c]));
    for (let t = 0; t < n; t++) {
      const r = f0 + t, pos = t + 1, fila = ws.getRow(r), k = e.kIdx[t], enRango = t >= e.i0 && t <= e.i1, conRango = t >= S.VENTANA;
      const c1 = `3*($E${r}-1)+1`, kP = S.primaK(e, k), { m, s } = S.rangoK(e, k);
      fila.getCell(1).value = fechaXL(e.fechas[t]); fila.getCell(1).numFmt = "dd/mm/yyyy";
      fila.getCell(2).value = e.co1[t]; fila.getCell(2).numFmt = "0.00";
      fila.getCell(3).value = e.cap[t]; fila.getCell(3).numFmt = "#,##0";
      fila.getCell(4).value = e.bal[t];
      fila.getCell(5).value = fx(`MATCH(D${r},'${e.id}'!$C$4:$Z$4,0)`, k + 1);
      fila.getCell(6).value = fx(`INDEX(${MAT},${pos},${c1})`, kP[t]); fila.getCell(6).numFmt = "0.00";
      if (conRango) {
        fila.getCell(7).value = fx(`INDEX(${MAT},${pos},${c1}+1)`, m[t]); fila.getCell(8).value = fx(`INDEX(${MAT},${pos},${c1}+2)`, s[t]);
        fila.getCell(9).value = fx(`G${r}-${CFG.z}*H${r}`, m[t] - cfg.z * s[t]); fila.getCell(10).value = fx(`G${r}+${CFG.z}*H${r}`, m[t] + cfg.z * s[t]);
        fila.getCell(11).value = fx(`IF(OR(F${r}<I${r},F${r}>J${r}),1,0)`, ev.fuera[t]);
        [7, 8, 9, 10].forEach(c => fila.getCell(c).numFmt = "0.00");
      }
      if (enRango && conRango) {
        const c = porT[t], rp = `INDEX(${MAT},${pos}+1,${c1}):INDEX(${MAT},$O${r},${c1})`, rm = `INDEX(${MAT},${pos}+1,${c1}+1):INDEX(${MAT},$O${r},${c1}+1)`, rs = `INDEX(${MAT},${pos}+1,${c1}+2):INDEX(${MAT},$O${r},${c1}+2)`;
        const cond = `(N${r}*(${rp}-${rm})<=${CFG.z}*${rs})`, cond2 = `(N${r}*(F${r}-${rp})>=${CFG.rec}*ABS(M${r}))`;
        let cuenta = 0;
        if (c) for (let i = t + 1; i <= Math.min(t + cfg.plazo, n - 1); i++) if (c.sg * (kP[i] - m[i]) <= cfg.z * s[i] && c.sg * (kP[t] - kP[i]) >= cfg.rec * Math.abs(c.d0)) cuenta++;
        fila.getCell(12).value = fx(`IF(AND(K${r}=1,N(K${r - 1})<>1),1,0)`, c ? 1 : 0);
        fila.getCell(13).value = fx(`IF(L${r}=1,F${r}-G${r},"")`, c ? c.d0 : ""); fila.getCell(13).numFmt = "0.00";
        fila.getCell(14).value = fx(`IF(L${r}=1,SIGN(M${r}),"")`, c ? c.sg : "");
        fila.getCell(15).value = fx(`IF(L${r}=1,MIN(${pos}+${CFG.plazo},${n}),"")`, c ? Math.min(pos + cfg.plazo, n) : "");
        fila.getCell(16).value = fx(`IF(L${r}=1,IF(O${r}>${pos},SUMPRODUCT(--${cond},--${cond2}),0),"")`, c ? cuenta : "");
        fila.getCell(17).value = fx(`IF(L${r}=1,IF(P${r}>0,1,IF(${pos}+${CFG.plazo}>${n},"censurado",0)),"")`, c ? (c.reg === null ? "censurado" : c.reg) : "");
        fila.getCell(18).value = fx(`IF(L${r}=1,IF(P${r}>0,MATCH(1,INDEX(${cond}*${cond2},0),0),""),"")`, c && c.h ? c.h : "");
        fila.getCell(19).value = fx(`IF(L${r}=1,IF(INDEX($E$${f0}:$E$${f0 + n - 1},O${r})<>E${r},1,0),"")`, c ? c.cruza : "");
        fila.getCell(23).value = { formula: `IF(L${r}=1,F${r},NA())`, result: c ? kP[t] : { error: "#N/A" } }; fila.getCell(23).numFmt = "0.00";
      }
      if (enRango && t >= 1) {
        fila.getCell(20).value = fx(`INDEX(${MAT},${pos},${c1})-INDEX(${MAT},${pos - 1},${c1})`, kP[t] - kP[t - 1]);
        fila.getCell(21).value = fx(`INDEX(${MAT},${pos - 1},${c1})`, kP[t - 1]);
        if (t - 1 >= e.i0 && t - 1 >= 1) { const kp = S.primaK(e, e.kIdx[t - 1]); fila.getCell(22).value = fx(`T${r - 1}`, kp[t - 1] - kp[t - 2]); }
        [20, 21, 22].forEach(c => fila.getCell(c).numFmt = "0.00");
      }
    }
    e.cals.forEach((cal, k) => {       // matriz: una terna por balance, solo donde hace falta (ventana + vigencia + evaluación)
      const cP = X0 + 3 * k, lP = col(cP - 1), hoja = `'${e.id}'!`, cb = col(2 + k), P = S.primaK(e, k), { m, s } = S.rangoK(e, k);
      const a0 = Math.max(0, e.primero[k] - S.VENTANA), a1 = Math.min(n - 1, e.ultimo[k] + 15);
      for (let t = a0; t <= a1; t++) {
        const r = f0 + t, fila = ws.getRow(r), p1 = `($C${r}-${hoja}${cb}$${C.B})/${hoja}${cb}$${C.A}`;
        fila.getCell(cP).value = fx(`IF(${p1}<${hoja}${cb}$${C.pk},($C${r}-${hoja}${cb}$${C.B0})/${hoja}${cb}$${C.A0},${p1})-$B${r}`, P[t]);
        fila.getCell(cP).numFmt = "0.00";
        if (t >= S.VENTANA && t >= e.primero[k]) {
          fila.getCell(cP + 1).value = fx(`AVERAGE(${lP}${r - 20}:${lP}${r - 1})`, m[t]); fila.getCell(cP + 2).value = fx(`STDEV(${lP}${r - 20}:${lP}${r - 1})`, s[t]);
          fila.getCell(cP + 1).numFmt = fila.getCell(cP + 2).numFmt = "0.00";
        }
      }
    });
    return { f0, n, r0: f0 + Math.max(e.i0, S.VENTANA), r1: f0 + e.i1 };
  }

  /* Referencia simulada: una fila por corrida, con la proporción de regresos de cada grupo (fuente de los percentiles de Consistencia). */
  function hojaSimulacion(wb, emps, grupos, corridas, base, obsTotal, N, seed) {
    const ws = wb.addWorksheet("Simulación", { views: [{ state: "frozen", ySplit: 24 }] }), S = window.BIStats;
    ws.getCell("A1").value = "Referencia simulada sin reversión (6.1 y 7.7)"; ws.getCell("A1").font = { bold: true, size: 13 };
    ["Cada corrida aplica la misma regla a una prima simulada: CO1 OBSERVADO menos un Brent implícito sin reversión, de modo que los regresos debidos al propio CO1 quedan en la referencia.",
     "Cambio diario del implícito = β·ΔCO1 + u. β y u salen de los cambios diarios observados con un mismo balance; u se remuestrea por fecha y en conjunto entre empresas, lo que conserva volatilidad y correlación y elimina la autocorrelación.",
     "Desfase horario remanente: sin historia intradiaria del CO1 (8.4), el ruido de cierre se mide con la autocovarianza de primer orden de u, σε² = máx(0, −cov(u_t, u_t−1)), y se suma como error i.i.d. sobre el nivel; la varianza del paseo aleatorio se reduce en 2σε².",
     `${N} corridas; semilla ${seed}; ${base.nPool} fechas en el remuestreo conjunto. Estos valores se calculan al exportar: no cambian si se editan los parámetros de Consistencia.`]
      .forEach((t, i) => { ws.getCell(`A${3 + i}`).value = t; Object.assign(ws.getCell(`A${3 + i}`), GRIS); });
    ws.getRow(8).values = ["Calibración", "β (ΔCO1)", "Vol. diaria u (USD/bbl)", "Autocorr. u (1)", "σε ruido (USD/bbl)"]; [1, 2, 3, 4, 5].forEach(c => Object.assign(ws.getCell(8, c), HEAD));
    ws.getRow(8).alignment = { wrapText: true, vertical: "middle" };
    emps.forEach((e, i) => { const f = ws.getRow(9 + i); f.getCell(1).value = e.id; [e.sim.beta, e.sim.volU, e.sim.ac1, e.sim.sigEps].forEach((v, k) => { f.getCell(2 + k).value = v; f.getCell(2 + k).numFmt = "0.000"; }); });
    const f0 = 25, fN = f0 + N - 1;
    ws.getRow(24).values = ["Corrida", ...grupos.map(g => g.nombre)]; ws.getRow(24).eachCell(c => Object.assign(c, HEAD));
    const props = grupos.map(g => corridas.map(c => S.propSim(c, emps, g.ids)));
    corridas.forEach((c, i) => { const f = ws.getRow(f0 + i); f.getCell(1).value = i + 1; grupos.forEach((g, j) => { const v = props[j][i]; if (v != null) { f.getCell(2 + j).value = v; f.getCell(2 + j).numFmt = "0.0%"; } }); });
    ws.getColumn(1).width = 14; grupos.forEach((g, j) => ws.getColumn(2 + j).width = 12);
    // histograma de la proporción total (alimenta el gráfico del Dashboard)
    const cH = 3 + grupos.length + 1, cT = col(grupos.length), L = i => col(cH - 1 + i), rH = 8;
    ["Desde", "Hasta", "Intervalo", "Simulaciones", "Observada"].forEach((t, c) => { const x = ws.getCell(rH, cH + c); x.value = t; Object.assign(x, HEAD); });
    const tot = props[grupos.length - 1].filter(v => v != null), mn = Math.floor(Math.min(...tot, obsTotal) * 25) / 25, nb = Math.min(15, Math.ceil((Math.max(...tot, obsTotal) - mn) / .04) + 1);
    const borde = i => Math.round((mn + i * .04) * 100) / 100, cuentas = Array.from({ length: nb }, (_, i) => tot.filter(v => v >= borde(i) && v < borde(i + 1)).length), mx = Math.max(...cuentas);
    for (let i = 0; i < nb; i++) {
      const r = rH + 1 + i, a = borde(i), b = borde(i + 1), rng = `$${cT}$${f0}:$${cT}$${fN}`;
      ws.getCell(r, cH).value = a; ws.getCell(r, cH + 1).value = b; ws.getCell(r, cH).numFmt = ws.getCell(r, cH + 1).numFmt = "0%";
      ws.getCell(r, cH + 2).value = fx(`TEXT(${L(0)}${r},"0%")&"–"&TEXT(${L(1)}${r},"0%")`, `${Math.round(a * 100)}%–${Math.round(b * 100)}%`);
      ws.getCell(r, cH + 3).value = fx(`COUNTIFS(${rng},">="&${L(0)}${r},${rng},"<"&${L(1)}${r})`, cuentas[i]);
    }
    return { f0, fN, colDe: g => col(1 + g), props, hist: { col: L, r0: rH + 1, r1: rH + nb, cH, cuentas, mx, mn } };
  }

  async function exportar(D, opts) {
    const ExcelJS = await libreria(), S = window.BIStats;
    const { desde, hasta, empresas, CAMPOS, avance = () => {} } = opts;
    const hi = D.historia, wb = new ExcelJS.Workbook(), { despeje } = S;
    wb.creator = "Barril Implícito — TIF Finanzas UADE"; wb.created = new Date();
    wb.calcProperties.fullCalcOnLoad = true;
    const emps = D.empresas.filter(e => empresas.includes(e.id) && hi.series[e.id] && hi.series[e.id].fecha.length)
      .map(e => { const p = S.preparar(D, e.id, desde, hasta); return p ? { ...p, info: e } : null; }).filter(Boolean);
    if (!emps.length) throw new Error("no hay datos para ese rango y esas empresas");
    const co1 = Object.fromEntries(hi.brent_1l.fecha.map((f, i) => [f, hi.brent_1l.valor[i]]));
    const Di = {}, CALS = {};
    emps.forEach(e => {
      CALS[e.id] = e.cals;
      const s = hi.series[e.id], porP = Object.fromEntries(e.cals.map(k => [k.periodo, k._k]));
      Di[e.id] = {};
      s.fecha.forEach((f, i) => { if (f < desde || f > hasta) return; const p = s.periodos[s.cal_idx[i]]; if (porP[p]) Di[e.id][f] = { cap: s.cap_musd[i], bal: p, xl: despeje(porP[p], s.cap_musd[i]), web: s.implicito[i] }; });
    });
    const fechas = [...new Set([...emps.flatMap(e => Object.keys(Di[e.id])), ...Object.keys(co1).filter(f => f >= desde && f <= hasta)])].sort();

    // --- test: especificación principal, referencia y sensibilidades (8.3)
    const CF = { z: 2, plazo: 10, rec: .5 }, NSIM = 2000, NSENS = 1000, SEMILLA = 20261103;
    emps.forEach(e => { e.ev = S.evaluar(e, CF); });
    const grupos = S.grupos(emps, D), base = S.calibrar(emps);
    avance("Simulando la referencia sin reversión…");
    const corridas = await S.simular(emps, base, CF, NSIM, SEMILLA);
    const todos = emps.map(e => e.id);
    const resumenCfg = async (cfg, N, sem) => {
      let cas = 0, reg = 0, cen = 0;
      emps.forEach(e => { const c = S.evaluar(e, cfg).casos; cas += c.length; reg += c.filter(x => x.reg === 1).length; cen += c.filter(x => x.reg === null).length; });
      const r = await S.simular(emps, base, cfg, N, sem), a = r.map(c => S.propSim(c, emps, todos)).filter(v => v != null);
      return { cas, reg, cen, prop: reg / (cas - cen), ref: S.media(a), umbral: S.percentil(a, .95) };
    };
    const ESC = [["Especificación principal (±2 desvíos, 10 ruedas, ½ d0)", CF], ["Banda de ±1,5 desvíos", { ...CF, z: 1.5 }], ["Banda de ±2,5 desvíos", { ...CF, z: 2.5 }], ["Plazo de 5 ruedas", { ...CF, plazo: 5 }], ["Plazo de 15 ruedas", { ...CF, plazo: 15 }], ["Recorrido mínimo de ⅓ d0", { ...CF, rec: 1 / 3 }], ["Recorrido mínimo de ⅔ d0", { ...CF, rec: 2 / 3 }], ["Ventana que reinicia con cada balance", { ...CF, reset: true }]];
    const sens = [];
    for (let i = 0; i < ESC.length; i++) { avance(`Sensibilidades (${i + 1}/${ESC.length})…`); sens.push({ nombre: ESC[i][0], ...(await resumenCfg(ESC[i][1], NSENS, SEMILLA + i + 1)) }); }
    avance("Armando las hojas…");

    // --- Leeme
    const lm = wb.addWorksheet("Leeme");
    lm.getColumn(1).width = 125;
    [["Barril Implícito — Brent implícito en la capitalización bursátil", { bold: true, size: 14 }],
     [`Generado: ${new Date().toLocaleString("es-AR")} · Rango: ${desde} a ${hasta} · Empresas: ${emps.map(e => e.id).join(", ")}`],
     [`Datos: serie de la web actualizada al ${(hi.actualizado || "").slice(0, 10)}. Estados contables: Bloomberg (terminal UADE) con EDGAR/releases para operativos (ver hoja de cada empresa, "Origen de cada dato").`],
     ["Si el archivo abre en Vista protegida, tocá \"Habilitar edición\" para que se actualicen fórmulas y gráficos."],
     [""],
     ["Hojas", { bold: true }],
     ["• Dashboard: indicadores y gráficos de la prima y del Brent implícito. Cada gráfico lee las celdas de las otras hojas."],
     ["• Consistencia: prueba de la hipótesis (6 y 6.1): casos, regresos y comparación con la referencia simulada, por empresa, región y estructura, más descripción de la prima, comparación entre pares, dinámica y sensibilidades."],
     ["• Implícitos: por día, CO1, y para cada empresa capitalización (MUSD), balance vigente, Brent implícito (fórmula) y prima = implícito − CO1; diferencias de prima entre pares."],
     ["• Resumen: signo, magnitud y variabilidad de la prima (objetivo a)."],
     ["• Una hoja por empresa: insumos de cada balance y cálculo con fórmulas (editables)."],
     ["• Rango <empresa>: rango habitual, casos y regresos rueda a rueda, con fórmulas."],
     ["• Simulación: las corridas de la referencia sin reversión y su calibración. Control: Excel vs. web."],
     [""],
     ["Método (forma cerrada del motor)", { bold: true }],
     ["Producción plana Q hasta agotar las reservas probadas (máx. 30 años), flujos a mitad de año descontados al WACC → volumen descontado V."],
     ["Valor del patrimonio = A·P + B, con A = V·a·(1−t) y B = V·(m·(1−t) + t·DD&A − capex/boe) + no-upstream − deuda neta − minoritarios."],
     ["Brent implícito P* = (capitalización − B) / A. Si P* < Pk (base imponible negativa), se usa el tramo sin impuesto: P* = (capitalización − B0) / A0."],
     ["a = participación del crudo × (1 − diferencial) × (1 − regalías − retenciones); m = margen por boe sin crudo (gas/NGL a precio fijo − lifting − otros costos)."],
     [""],
     ["CO1 (Brent, primer futuro ICE)", { bold: true }],
     ["Cierre diario de Yahoo Finance BZ=F como proxy del CO1 Comdty de Bloomberg (el archivo bajado de la terminal vino vacío). No es el precio a la hora de cierre de cada acción que pide 6.1: sin historia intradiaria, el desfase se trata como ruido de cierre en la referencia (8.4)."],
     ["La prima usa el CO1 del mismo día; los días sin cotización de alguna de las dos quedan en blanco. Las hojas Rango incluyen hasta 20 ruedas antes y 15 después del rango elegido, para la ventana y la evaluación."],
     [""],
     ["Los insumos son editables: cambiar un valor en la hoja de una empresa recalcula su implícito, sus casos y los gráficos."],
    ].forEach(([t, f], i) => { const c = lm.getCell(`A${i + 1}`); c.value = t; if (f) c.font = f; c.alignment = { wrapText: true }; });

    wb.addWorksheet("Dashboard", { views: [{ showGridLines: false }] });
    wb.addWorksheet("Consistencia", { views: [{ state: "frozen", ySplit: 2 }] });

    // --- hojas por empresa
    emps.forEach(e => hojaEmpresa(wb, e.info, CALS[e.id], CAMPOS));

    // --- Implícitos
    const im = wb.addWorksheet("Implícitos", { views: [{ state: "frozen", xSplit: 2, ySplit: 4 }] });
    im.getCell("A1").value = "Brent implícito diario por empresa y CO1"; im.getCell("A1").font = { bold: true, size: 13 };
    im.getCell("A2").value = "Implícito = fórmula sobre la hoja de cada empresa (balance vigente ese día). Prima = implícito − CO1, en USD/bbl.";
    Object.assign(im.getCell("A2"), GRIS);
    const cab = ["Fecha", "CO1 (USD/bbl)"], ubic = {};
    emps.forEach((e, j) => { ubic[e.id] = 3 + 4 * j; cab.push(`${e.id} cap. (MUSD)`, `${e.id} balance`, `${e.id} implícito`, `${e.id} prima`); });
    const PARES = [["VIST", "YPF"], ["EOG", "SU"], ["PRIO", "PBR"]].filter(([a, b]) => ubic[a] && ubic[b]), cPar0 = 3 + 4 * emps.length;
    PARES.forEach(([a, b]) => cab.push(`Prima ${a} − ${b}`));
    im.getRow(4).values = cab; im.getRow(4).eachCell(c => Object.assign(c, HEAD)); im.getRow(4).alignment = { wrapText: true, vertical: "middle" };
    im.getRow(4).height = 30; im.getColumn(1).width = 11; im.getColumn(2).width = 10;
    fechas.forEach((f, i) => {
      const r = 5 + i, fila = im.getRow(r);
      fila.getCell(1).value = fechaXL(f); fila.getCell(1).numFmt = "dd/mm/yyyy";
      if (co1[f] != null) { fila.getCell(2).value = co1[f]; fila.getCell(2).numFmt = "0.00"; }
      emps.forEach(e => {
        const c0 = ubic[e.id], d = Di[e.id][f], cC = col(c0 - 1), cB = col(c0), cI = col(c0 + 1);
        if (!d) return;
        const rng = fr => `'${e.id}'!$C$${fr}:$Z$${fr}`, k = `MATCH(${cB}${r},'${e.id}'!$C$4:$Z$4,0)`;
        const p1 = `(${cC}${r}-INDEX(${rng(C.B)},${k}))/INDEX(${rng(C.A)},${k})`;
        fila.getCell(c0).value = d.cap; fila.getCell(c0).numFmt = "#,##0";
        fila.getCell(c0 + 1).value = d.bal;
        fila.getCell(c0 + 2).value = fx(`IF(${p1}<INDEX(${rng(C.pk)},${k}),(${cC}${r}-INDEX(${rng(C.B0)},${k}))/INDEX(${rng(C.A0)},${k}),${p1})`, d.xl);
        fila.getCell(c0 + 2).numFmt = "0.00";
        if (co1[f] != null) { fila.getCell(c0 + 3).value = fx(`${cI}${r}-$B${r}`, d.xl - co1[f]); fila.getCell(c0 + 3).numFmt = "0.00"; }
      });
      PARES.forEach(([a, b], j) => {
        const da = Di[a]?.[f], db = Di[b]?.[f]; if (!da || !db || co1[f] == null) return;
        fila.getCell(cPar0 + j).value = fx(`${col(ubic[a] + 2)}${r}-${col(ubic[b] + 2)}${r}`, da.xl - db.xl); fila.getCell(cPar0 + j).numFmt = "0.00";
      });
    });
    emps.forEach(e => { const c0 = ubic[e.id]; [11, 9, 10, 9].forEach((w, k) => im.getColumn(c0 + k).width = w); });
    PARES.forEach((_, j) => im.getColumn(cPar0 + j).width = 11);
    const ult = 4 + fechas.length, rIm = c => `'Implícitos'!$${c}$5:$${c}$${ult}`;

    // --- Control
    const ct = wb.addWorksheet("Control", { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
    ct.getCell("A1").value = "Control: implícito de este Excel vs. implícito de la web (motor por bisección, tolerancia 0,005)"; ct.getCell("A1").font = { bold: true };
    ct.getRow(4).values = ["Fecha", ...emps.flatMap(e => [`${e.id} web`, `${e.id} Excel − web`])];
    ct.getRow(4).eachCell(c => Object.assign(c, HEAD)); ct.getColumn(1).width = 11;
    fechas.forEach((f, i) => {
      const r = 5 + i, fila = ct.getRow(r); fila.getCell(1).value = fechaXL(f); fila.getCell(1).numFmt = "dd/mm/yyyy";
      emps.forEach((e, j) => { const d = Di[e.id][f]; if (!d || d.web == null) return;
        const cw = 2 + 2 * j, ci = col(ubic[e.id] + 1), cwL = col(cw - 1);
        fila.getCell(cw).value = d.web; fila.getCell(cw).numFmt = "0.00";
        fila.getCell(cw + 1).value = fx(`'Implícitos'!${ci}${r}-${cwL}${r}`, d.xl - d.web); fila.getCell(cw + 1).numFmt = "0.000"; });
    });

    // --- Resumen (objetivo a)
    const rs = wb.addWorksheet("Resumen");
    rs.getCell("A1").value = `Prima = implícito − CO1 (USD/bbl), del ${desde} al ${hasta}`; rs.getCell("A1").font = { bold: true, size: 13 };
    const primas = Object.fromEntries(emps.map(e => [e.id, fechas.filter(f => Di[e.id][f] && co1[f] != null).map(f => Di[e.id][f].xl - co1[f])]));
    const impls = Object.fromEntries(emps.map(e => [e.id, Object.values(Di[e.id]).map(d => d.xl)]));
    const abs = a => S.media(a.map(Math.abs)), sd = a => Math.sqrt(S.devsq(a) / (a.length - 1));
    const met = [["Días con implícito", c => `COUNT(${c})`, "0", "i", a => a.length], ["Implícito medio", c => `AVERAGE(${c})`, "0.00", "i", S.media],
      ["Días con prima", c => `COUNT(${c})`, "0", "p", a => a.length], ["Prima media (signo)", c => `AVERAGE(${c})`, "0.00", "p", S.media],
      ["Prima media en valor absoluto (magnitud)", c => `(SUMIF(${c},">0")-SUMIF(${c},"<0"))/COUNT(${c})`, "0.00", "p", abs],
      ["Desvío estándar de la prima (variabilidad)", c => `STDEV(${c})`, "0.00", "p", sd], ["Prima mínima", c => `MIN(${c})`, "0.00", "p", a => Math.min(...a)],
      ["Prima máxima", c => `MAX(${c})`, "0.00", "p", a => Math.max(...a)], ["% de días con prima positiva", c => `COUNTIF(${c},">0")/COUNT(${c})`, "0%", "p", a => a.filter(v => v > 0).length / a.length],
      ["Balances usados", null, "0", "n"], ["Control: máx. |Excel − web|", null, "0.000", "c"]];
    rs.getRow(3).values = ["Métrica", ...emps.map(e => e.id)]; rs.getRow(3).eachCell(c => Object.assign(c, HEAD)); rs.getColumn(1).width = 44;
    const filaRs = {};
    met.forEach(([lab, f_, nf, q, js], i) => {
      const fila = rs.getRow(4 + i); fila.getCell(1).value = lab; filaRs[lab] = 4 + i;
      emps.forEach((e, j) => {
        const cell = fila.getCell(2 + j); cell.numFmt = nf; rs.getColumn(2 + j).width = 12;
        const ci = col(ubic[e.id] + (q === "i" ? 1 : 2));
        if (q === "n") cell.value = CALS[e.id].length;
        else if (q === "c") { const cd = col(2 + 2 * j), a = Object.values(Di[e.id]).filter(d => d.web != null).map(d => Math.abs(d.xl - d.web)); cell.value = fx(`MAX(MAX(Control!${cd}5:${cd}${ult}),-MIN(Control!${cd}5:${cd}${ult}))`, Math.max(...a)); }
        else cell.value = fx(f_(`'Implícitos'!${ci}5:${ci}${ult}`), js(q === "i" ? impls[e.id] : primas[e.id]));
      });
    });

    // --- Rango por empresa y Simulación
    const RG = {};
    emps.forEach(e => { RG[e.id] = hojaRango(wb, e, e.ev, CF); });
    const obsCas = emps.flatMap(e => e.ev.casos);
    const obsTotal = obsCas.filter(c => c.reg === 1).length / obsCas.filter(c => c.reg !== null).length;
    const SIM = hojaSimulacion(wb, emps, grupos, corridas, base, obsTotal, NSIM, SEMILLA), props = SIM.props;

    // --- Consistencia
    const cs = wb.getWorksheet("Consistencia");
    cs.getColumn(1).width = 50; for (let c = 2; c <= 15; c++) cs.getColumn(c).width = 12.5;
    cs.getCell("A1").value = "Consistencia de la prima: ¿los desvíos amplios son transitorios?"; cs.getCell("A1").font = { bold: true, size: 14 };
    cs.getCell("A2").value = `Rango ${desde} a ${hasta} · ${emps.map(e => e.id).join(", ")}`; Object.assign(cs.getCell("A2"), GRIS);
    cs.getCell("A3").value = "Hipótesis (6): la proporción de desvíos amplios que regresa a su rango habitual en el corto plazo supera el umbral de una referencia simulada sin reversión. Es una comparación descriptiva con una referencia, no una prueba de significación (7.7).";
    cs.mergeCells("A3:O3"); cs.getCell("A3").alignment = { wrapText: true, vertical: "top" }; cs.getRow(3).height = 32;
    const titPanel = (r, t) => { const c = cs.getCell(`A${r}`); c.value = t; cs.mergeCells(`A${r}:O${r}`); Object.assign(c, SUB); };
    titPanel(5, "Especificación (6.1). Cambiar estos valores recalcula los casos y los regresos observados; la referencia simulada queda en la especificación principal");
    [["Ventana del rango habitual (ruedas previas)", S.VENTANA, "Fija: 20 ruedas ≈ un mes bursátil"], ["Banda: desvíos estándar", CF.z, "Principal: 2. Sensibilidad: 1,5 y 2,5"], ["Plazo de regreso (ruedas, máx. 15)", CF.plazo, "Principal: 10. Sensibilidad: 5 y 15"],
     ["Recorrido mínimo hacia la media (× d0)", CF.rec, "Principal: ½. Sensibilidad: ⅓ y ⅔"], ["Percentil de la referencia usado como umbral", 95, "El grupo debe confirmarlo: la tesis no fija el percentil"]]
      .forEach(([l, v, n], i) => { const r = 6 + i; cs.getCell(`A${r}`).value = l; const c = cs.getCell(`C${r}`); c.value = v; c.font = { bold: true, color: { argb: "FF0000C0" } }; if (i) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8DC" } }; cs.getCell(`D${r}`).value = n; Object.assign(cs.getCell(`D${r}`), GRIS); });
    cs.getCell("C8").dataValidation = { type: "whole", operator: "between", formulae: [1, 15], showErrorMessage: true, error: "Entre 1 y 15 ruedas" };

    // Panel A: objetivo c) y prueba de la hipótesis
    const rA = 12; titPanel(rA, "A. Regreso de los desvíos amplios frente a la referencia simulada (objetivo c y hipótesis)");
    cs.getRow(rA + 1).values = ["Grupo", "Casos", "Regresos", "No regresan", "Censurados", "Proporción de regreso", "Referencia media", "Umbral (percentil)", "Exceso sobre umbral", "¿Supera el umbral?", "Posición en la referencia", "Ruedas medias hasta regreso", "|d0| medio (USD/bbl)", "Casos que cruzan balance", "Proporción sin cruzar balance"];
    cs.getRow(rA + 1).eachCell(c => Object.assign(c, HEAD)); cs.getRow(rA + 1).alignment = { wrapText: true, vertical: "middle", horizontal: "center" }; cs.getRow(rA + 1).height = 45;
    const filaG = {}; grupos.forEach((g, i) => { filaG[g.nombre] = rA + 2 + i; });
    const obsDe = ids => { const c = emps.filter(e => ids.includes(e.id)).flatMap(e => e.ev.casos); const reg = c.filter(x => x.reg === 1).length, no = c.filter(x => x.reg === 0).length, cen = c.filter(x => x.reg === null).length, sc = c.filter(x => !x.cruza && x.reg !== null), rc = c.filter(x => x.reg === 1 && x.h);
      return { n: c.length, reg, no, cen, prop: reg + no ? reg / (reg + no) : null, h: rc.length ? S.media(rc.map(x => x.h)) : null, d0: c.length ? S.media(c.map(x => Math.abs(x.d0))) : null, cruza: c.filter(x => x.cruza).length, propSc: sc.length ? sc.filter(x => x.reg === 1).length / sc.length : null }; };
    const R = (id, c_) => `'Rango ${id}'!$${c_}$${RG[id].f0}:$${c_}$${RG[id].f0 + RG[id].n - 1}`;
    grupos.forEach((g, i) => {
      const r = filaG[g.nombre], f = cs.getRow(r), o = obsDe(g.ids), simC = `'Simulación'!$${SIM.colDe(i)}$${SIM.f0}:$${SIM.colDe(i)}$${SIM.fN}`, a = props[i].filter(v => v != null);
      const um = S.percentil(a, .95), suma = c => g.ids.map(id => `${c}${filaG[id]}`).join("+");
      f.getCell(1).value = g.nombre;
      if (!g.tipo) {
        const id = g.ids[0];
        f.getCell(2).value = fx(`SUM(${R(id, "L")})`, o.n); f.getCell(3).value = fx(`COUNTIF(${R(id, "Q")},1)`, o.reg); f.getCell(4).value = fx(`COUNTIF(${R(id, "Q")},0)`, o.no); f.getCell(5).value = fx(`COUNTIF(${R(id, "Q")},"censurado")`, o.cen);
        f.getCell(12).value = fx(`IFERROR(AVERAGE(${R(id, "R")}),"")`, o.h ?? ""); f.getCell(13).value = fx(`IFERROR((SUMIF(${R(id, "M")},">0")-SUMIF(${R(id, "M")},"<0"))/COUNT(${R(id, "M")}),"")`, o.d0 ?? "");
        f.getCell(14).value = fx(`SUM(${R(id, "S")})`, o.cruza);
        f.getCell(15).value = fx(`IFERROR(COUNTIFS(${R(id, "Q")},1,${R(id, "S")},0)/(COUNTIFS(${R(id, "Q")},1,${R(id, "S")},0)+COUNTIFS(${R(id, "Q")},0,${R(id, "S")},0)),"")`, o.propSc ?? "");
      } else {
        ["B", "C", "D", "E", "N"].forEach((c, k) => { f.getCell(c).value = fx(suma(c), [o.n, o.reg, o.no, o.cen, o.cruza][k]); });
        const pond = (c, w) => `IFERROR((${g.ids.map(id => `N(${c}${filaG[id]})*${w}${filaG[id]}`).join("+")})/(${suma(w)}),"")`;
        f.getCell("L").value = fx(pond("L", "C"), o.h ?? ""); f.getCell("M").value = fx(pond("M", "B"), o.d0 ?? "");
        f.getCell("O").value = fx(`IFERROR((${g.ids.map(id => `COUNTIFS(${R(id, "Q")},1,${R(id, "S")},0)`).join("+")})/(${g.ids.map(id => `COUNTIFS(${R(id, "Q")},1,${R(id, "S")},0)+COUNTIFS(${R(id, "Q")},0,${R(id, "S")},0)`).join("+")}),"")`, o.propSc ?? "");
      }
      f.getCell(6).value = fx(`IF(C${r}+D${r}>0,C${r}/(C${r}+D${r}),"")`, o.prop ?? "");
      f.getCell(7).value = fx(`AVERAGE(${simC})`, S.media(a)); f.getCell(8).value = fx(`PERCENTILE(${simC},$C$10/100)`, um);
      f.getCell(9).value = fx(`IF(F${r}="","",F${r}-H${r})`, o.prop == null ? "" : o.prop - um);
      f.getCell(10).value = fx(`IF(F${r}="","",IF(F${r}>H${r},"Sí","No"))`, o.prop == null ? "" : (o.prop > um ? "Sí" : "No")); f.getCell(10).alignment = { horizontal: "center" };
      f.getCell(11).value = fx(`IF(F${r}="","",COUNTIF(${simC},"<="&F${r})/COUNT(${simC}))`, o.prop == null ? "" : a.filter(v => v <= o.prop).length / a.length);
      [6, 7, 8, 11, 15].forEach(c => f.getCell(c).numFmt = "0.0%"); f.getCell(9).numFmt = "+0.0%;-0.0%"; f.getCell(12).numFmt = "0.0"; f.getCell(13).numFmt = "0.00";
      if (g.tipo === "total") f.eachCell(c => { c.font = { bold: true }; c.fill = SUB.fill; });
    });
    const rTot = filaG["Total"], oT = obsDe(todos), aT = props[grupos.length - 1].filter(v => v != null), umT = S.percentil(aT, .95);
    let r = rTot + 1;
    const dec = v => String(Math.round(v * 1000) / 10).replace(".", ","), lectura = (p, u) => `Lectura: la proporción de regreso (${dec(p)}%) ${p > u ? "supera" : "no supera"} el umbral (${dec(u)}%): la hipótesis ${p > u ? "se sostiene" : "no se sostiene"} con esta especificación.`;
    cs.getCell(`A${r}`).value = fx(`"Lectura: la proporción de regreso ("&ROUND(F${rTot}*100,1)&"%) "&IF(F${rTot}>H${rTot},"supera","no supera")&" el umbral ("&ROUND(H${rTot}*100,1)&"%): la hipótesis "&IF(F${rTot}>H${rTot},"se sostiene","no se sostiene")&" con esta especificación."`, lectura(oT.prop, umT));
    cs.getCell(`A${r}`).font = { bold: true }; r += 1;
    cs.getCell(`A${r}`).value = "Por empresa hay pocos casos y el umbral es más alto: el contraste de la hipótesis es el total. Censurado: sin regreso y con menos ruedas posteriores que el plazo; no entra en el denominador."; Object.assign(cs.getCell(`A${r}`), GRIS); r += 2;

    // Panel B: objetivo a) por trimestre
    titPanel(r, "B. Prima media por trimestre, USD/bbl (objetivo a: evolución, signo y magnitud). Signo, magnitud y desvío del período completo en la hoja Resumen"); r++;
    cs.getRow(r).values = ["Trimestre", "Desde", "Hasta", ...emps.map(e => e.id)]; cs.getRow(r).eachCell(c => Object.assign(c, HEAD)); const rBc = r; r++;
    const trims = []; { let y = +desde.slice(0, 4), q = Math.floor((+desde.slice(5, 7) - 1) / 3); for (;;) { const a = new Date(Date.UTC(y, q * 3, 1)), b = new Date(Date.UTC(y, q * 3 + 3, 0)), ai = a.toISOString().slice(0, 10), bi = b.toISOString().slice(0, 10); if (ai > hasta) break; trims.push({ n: `${q + 1}T${y}`, a, b, ai, bi }); q++; if (q > 3) { q = 0; y++; } } }
    const rB0 = r;
    trims.forEach(t => { const f = cs.getRow(r); f.getCell(1).value = t.n; f.getCell(2).value = t.a; f.getCell(3).value = t.b; f.getCell(2).numFmt = f.getCell(3).numFmt = "dd/mm/yyyy";
      emps.forEach((e, j) => { const vs = fechas.filter(d => d >= t.ai && d <= t.bi && Di[e.id][d] && co1[d] != null).map(d => Di[e.id][d].xl - co1[d]), cp = col(ubic[e.id] + 2);
        f.getCell(4 + j).value = fx(`IFERROR(AVERAGEIFS(${rIm(cp)},${rIm("A")},">="&$B${r},${rIm("A")},"<="&$C${r}),"")`, vs.length ? S.media(vs) : ""); f.getCell(4 + j).numFmt = "0.0"; }); r++; });
    const rB1 = r - 1; r++;

    // Panel C: objetivo b)
    titPanel(r, "C. Comparación entre empresas (objetivo b). Correlación de las primas y diferencias entre los pares de cada región"); r++;
    cs.getRow(r).values = ["Correlación de primas", ...emps.map(e => e.id)]; cs.getRow(r).eachCell(c => Object.assign(c, HEAD)); r++;
    const serieCom = (a, b) => { const x = [], y = []; fechas.forEach(f => { if (Di[a][f] && Di[b][f] && co1[f] != null) { x.push(Di[a][f].xl - co1[f]); y.push(Di[b][f].xl - co1[f]); } }); return [x, y]; };
    const corr = (x, y) => S.cov(x, y) / Math.sqrt(S.devsq(x) / (x.length - 1) * S.devsq(y) / (y.length - 1));
    emps.forEach(e => { const f = cs.getRow(r); f.getCell(1).value = e.id; emps.forEach((o, j) => { const [x, y] = serieCom(e.id, o.id); f.getCell(2 + j).value = fx(`CORREL(${rIm(col(ubic[e.id] + 2))},${rIm(col(ubic[o.id] + 2))})`, corr(x, y)); f.getCell(2 + j).numFmt = "0.00"; }); r++; });
    r++;
    if (PARES.length) {
      cs.getRow(r).values = ["Par (misma región; perfil puro − integrada)", "Diferencia media", "|Diferencia| media", "Desvío", "Mínima", "Máxima", "% días perfil puro > integrada"]; cs.getRow(r).eachCell(c => Object.assign(c, HEAD)); cs.getRow(r).alignment = { wrapText: true, vertical: "middle" }; cs.getRow(r).height = 32; r++;
      PARES.forEach(([a, b], j) => { const rg = rIm(col(cPar0 + j - 1)), [x, y] = serieCom(a, b), d = x.map((v, i) => v - y[i]), f = cs.getRow(r);
        f.getCell(1).value = `${a} − ${b} (${D.empresas.find(e => e.id === a).region})`;
        [[`AVERAGE(${rg})`, S.media(d)], [`(SUMIF(${rg},">0")-SUMIF(${rg},"<0"))/COUNT(${rg})`, abs(d)], [`STDEV(${rg})`, sd(d)], [`MIN(${rg})`, Math.min(...d)], [`MAX(${rg})`, Math.max(...d)]].forEach(([fm, js], k) => { f.getCell(2 + k).value = fx(fm, js); f.getCell(2 + k).numFmt = "0.00"; });
        f.getCell(7).value = fx(`COUNTIF(${rg},">0")/COUNT(${rg})`, d.filter(v => v > 0).length / d.length); f.getCell(7).numFmt = "0%"; r++; });
      r++;
    }
    cs.getRow(r).values = ["Prima media por grupo (promedio de empresas)", "Prima media", "|Prima| media"]; cs.getRow(r).eachCell(c => Object.assign(c, HEAD)); r++;
    grupos.filter(g => g.tipo && g.tipo !== "total").forEach(g => { const f = cs.getRow(r), cols = g.ids.map(id => col(1 + emps.findIndex(e => e.id === id)));
      f.getCell(1).value = g.nombre; f.getCell(2).value = fx(`AVERAGE(${cols.map(c => `Resumen!${c}${filaRs["Prima media (signo)"]}`).join(",")})`, S.media(g.ids.map(id => S.media(primas[id]))));
      f.getCell(3).value = fx(`AVERAGE(${cols.map(c => `Resumen!${c}${filaRs["Prima media en valor absoluto (magnitud)"]}`).join(",")})`, S.media(g.ids.map(id => abs(primas[id])))); f.getCell(2).numFmt = f.getCell(3).numFmt = "0.00"; r++; });
    r++;

    // Panel D: dinámica de la prima
    titPanel(r, "D. Dinámica de la prima con un mismo balance: evidencia complementaria sobre reversión y ruido de cierre (7.6 y 8.4). Descriptiva"); r++;
    cs.getRow(r).values = ["Métrica", ...emps.map(e => e.id)]; cs.getRow(r).eachCell(c => Object.assign(c, HEAD)); r++;
    const din = emps.map(e => { const d = [], l = [], dl = [], dd = [], fue = [];
      for (let t = e.i0; t <= e.i1; t++) { if (t < 1) continue; const P = S.primaK(e, e.kIdx[t]); d.push(P[t] - P[t - 1]); l.push(P[t - 1]); if (t - 1 >= e.i0 && t - 1 >= 1) { const Q = S.primaK(e, e.kIdx[t - 1]); dl.push(Q[t - 1] - Q[t - 2]); dd.push(P[t] - P[t - 1]); } if (t >= S.VENTANA) fue.push(e.ev.fuera[t]); }
      const b = S.cov(d, l) / (S.devsq(l) / (l.length - 1)), a0 = S.media(d) - b * S.media(l), res = d.map((v, i) => v - a0 - b * l[i]), se = Math.sqrt(res.reduce((x, y) => x + y * y, 0) / (d.length - 2)) / Math.sqrt(S.devsq(l));
      const md = S.media(d), sdd = sd(d), n = d.length, skew = n / ((n - 1) * (n - 2)) * d.reduce((x, y) => x + ((y - md) / sdd) ** 3, 0), kurt = n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * d.reduce((x, y) => x + ((y - md) / sdd) ** 4, 0) - 3 * (n - 1) ** 2 / ((n - 2) * (n - 3));
      return { b, se, rho: 1 + b, ac: corr(dd, dl), ruido: Math.sqrt(Math.max(0, -S.cov(dd, dl) * (dd.length - 1) / dd.length)), fue: S.media(fue), skew, kurt, sdd }; });
    const filasD = [["% de ruedas fuera del rango (≈5 % si la prima fuera normal)", e => `SUM('Rango ${e.id}'!$K$${RG[e.id].r0}:$K$${RG[e.id].r1})/COUNT('Rango ${e.id}'!$K$${RG[e.id].r0}:$K$${RG[e.id].r1})`, d => d.fue, "0.0%"],
      ["Coeficiente AR(1) de la prima (ρ)", e => `1+SLOPE(${R(e.id, "T")},${R(e.id, "U")})`, d => d.rho, "0.000"],
      ["Vida media del desvío (ruedas) = ln(0,5)/ln(ρ)", (e, q, rr) => `IF(AND(${q}${rr - 1}>0,${q}${rr - 1}<1),LN(0.5)/LN(${q}${rr - 1}),"sin reversión")`, d => d.rho > 0 && d.rho < 1 ? Math.log(.5) / Math.log(d.rho) : "sin reversión", "0.0"],
      ["Estadístico t de (ρ−1), tipo Dickey-Fuller (referencia 5 %: −2,86)", e => `SLOPE(${R(e.id, "T")},${R(e.id, "U")})/(STEYX(${R(e.id, "T")},${R(e.id, "U")})/SQRT(DEVSQ(${R(e.id, "U")})))`, d => d.b / d.se, "0.00"],
      ["Autocorrelación de los cambios diarios de la prima", e => `CORREL(${R(e.id, "T")},${R(e.id, "V")})`, d => d.ac, "0.000"],
      ["Ruido de cierre implícito (USD/bbl) = √máx(0, −cov)", e => `SQRT(MAX(0,-COVAR(${R(e.id, "T")},${R(e.id, "V")})))`, d => d.ruido, "0.000"],
      ["Desvío de los cambios diarios (USD/bbl)", e => `STDEV(${R(e.id, "T")})`, d => d.sdd, "0.00"], ["Asimetría de los cambios diarios", e => `SKEW(${R(e.id, "T")})`, d => d.skew, "0.00"], ["Curtosis en exceso de los cambios diarios", e => `KURT(${R(e.id, "T")})`, d => d.kurt, "0.00"]];
    filasD.forEach(([lab, fm, js, nf]) => { const f = cs.getRow(r); f.getCell(1).value = lab; emps.forEach((e, j) => { f.getCell(2 + j).value = fx(fm(e, col(1 + j), r), js(din[j])); f.getCell(2 + j).numFmt = nf; }); r++; });
    cs.getCell(`A${r}`).value = "Un ρ menor que 1 con vida media de días es compatible con desvíos transitorios; una vida media larga, con una prima persistente. La regla del panel A es la que define la hipótesis."; Object.assign(cs.getCell(`A${r}`), GRIS); r += 2;

    // Panel E: sensibilidades de 8.3
    titPanel(r, "E. Sensibilidades (8.3 y 8.4), con la referencia recalculada en cada fila. Valores calculados al exportar"); r++;
    cs.getRow(r).values = ["Escenario", "Casos", "Regresos", "Censurados", "Proporción", "Referencia media", "Umbral P95", "Exceso", "¿Supera?"]; cs.getRow(r).eachCell(c => Object.assign(c, HEAD)); r++;
    const filaS = (v) => { const f = cs.getRow(r); f.values = v; [5, 6, 7].forEach(c => f.getCell(c).numFmt = "0.0%"); f.getCell(8).numFmt = "+0.0%;-0.0%"; f.getCell(9).alignment = { horizontal: "center" }; r++; };
    sens.forEach(s => filaS([s.nombre, s.cas, s.reg, s.cen, s.prop, s.ref, s.umbral, s.prop - s.umbral, s.prop > s.umbral ? "Sí" : "No"]));
    { const c = obsCas.filter(x => !x.cruza && x.reg !== null), reg = c.filter(x => x.reg === 1).length, m = sens[0]; filaS(["Solo casos que no cruzan un balance (referencia principal)", c.length, reg, 0, reg / c.length, m.ref, m.umbral, reg / c.length - m.umbral, reg / c.length > m.umbral ? "Sí" : "No"]); }
    cs.getCell(`A${r}`).value = `Corridas: ${NSENS} por escenario (${NSIM} en el panel A), por eso la principal puede diferir unas décimas. El control contra el CO12 de 8.4 no se calcula: no hay historia del CO12 en la web.`; Object.assign(cs.getCell(`A${r}`), GRIS); r += 2;

    // Panel F: lista de casos
    titPanel(r, "F. Casos de la especificación principal (lista al exportar; los valores leen las hojas Rango)"); r++;
    cs.getRow(r).values = ["Empresa", "Fecha del desvío", "Balance", "Prima", "Media 20", "d0", "Regresó", "Ruedas hasta regreso", "Cruza balance"]; cs.getRow(r).eachCell(c => Object.assign(c, HEAD)); cs.getRow(r).alignment = { wrapText: true, vertical: "middle" }; r++;
    emps.forEach(e => e.ev.casos.forEach(c => { const f = cs.getRow(r), q = RG[e.id].f0 + c.t, h = `'Rango ${e.id}'!`, m = S.rangoK(e, c.k).m[c.t];
      f.getCell(1).value = e.id; f.getCell(2).value = fx(`${h}A${q}`, fechaXL(e.fechas[c.t])); f.getCell(2).numFmt = "dd/mm/yyyy"; f.getCell(3).value = fx(`${h}D${q}`, e.bal[c.t]);
      f.getCell(4).value = fx(`${h}F${q}`, m + c.d0); f.getCell(5).value = fx(`${h}G${q}`, m); f.getCell(6).value = fx(`${h}M${q}`, c.d0); [4, 5, 6].forEach(k => f.getCell(k).numFmt = "0.00");
      f.getCell(7).value = fx(`${h}Q${q}`, c.reg === null ? "censurado" : c.reg); f.getCell(8).value = fx(`${h}R${q}`, c.h ?? ""); f.getCell(9).value = fx(`${h}S${q}`, c.cruza); r++; }));

    // --- observada en el histograma
    const sh = wb.getWorksheet("Simulación"), H_ = SIM.hist;
    for (let q = H_.r0; q <= H_.r1; q++) { const a = sh.getCell(q, H_.cH).value, b = sh.getCell(q, H_.cH + 1).value;
      sh.getCell(q, H_.cH + 4).value = fx(`IF(AND(Consistencia!$F$${rTot}>=${H_.col(0)}${q},Consistencia!$F$${rTot}<${H_.col(1)}${q}),MAX(${H_.col(3)}$${H_.r0}:${H_.col(3)}$${H_.r1}),0)`, oT.prop >= a && oT.prop < b ? H_.mx : 0); }

    // --- Dashboard
    const ds = wb.getWorksheet("Dashboard");
    for (let c = 1; c <= 24; c++) ds.getColumn(c).width = 8.5;
    ds.getCell("A1").value = "Brent implícito y prima: dashboard"; ds.getCell("A1").font = { bold: true, size: 16 };
    ds.getCell("A2").value = `Rango ${desde} a ${hasta} · ${emps.map(e => e.id).join(", ")} · Los gráficos e indicadores leen las celdas de las demás hojas`; Object.assign(ds.getCell("A2"), GRIS);
    const KPI = [["Desvíos amplios (casos)", `Consistencia!B${rTot}`, oT.n, "0"], ["Regresan en el plazo", `Consistencia!C${rTot}`, oT.reg, "0"], ["Proporción de regreso", `Consistencia!F${rTot}`, oT.prop, "0.0%"],
      ["Referencia simulada (media)", `Consistencia!G${rTot}`, S.media(aT), "0.0%"], ["Umbral (percentil de la referencia)", `Consistencia!H${rTot}`, umT, "0.0%"], ["¿Supera el umbral?", `IF(Consistencia!F${rTot}>Consistencia!H${rTot},"Sí","No")`, oT.prop > umT ? "Sí" : "No", "General"]];
    KPI.forEach(([lab, fm, js, nf], i) => { const a = col(4 * i), b = col(4 * i + 3);
      ds.mergeCells(`${a}4:${b}4`); ds.mergeCells(`${a}5:${b}6`);
      const t = ds.getCell(`${a}4`), v = ds.getCell(`${a}5`); t.value = lab; t.font = { size: 9, color: { argb: "FF555555" } }; t.alignment = { horizontal: "center", wrapText: true };
      v.value = fx(fm, js); v.numFmt = nf; v.font = { bold: true, size: 18, color: { argb: "FF1F3A4D" } }; v.alignment = { horizontal: "center", vertical: "middle" }; v.fill = SUB.fill; t.fill = SUB.fill; });
    const cat = `'Implícitos'!$A$5:$A$${ult}`, gr = [], nomIm = c => `'Implícitos'!$${c}$4`, poner = (g, c0, f0, c1, f1) => gr.push({ ...g, pos: [c0, f0, c1, f1] });
    let fg = 7;
    poner({ titulo: "Evolución del Brent implícito por empresa y CO1 (USD/bbl)", tipo: "line", fmtY: "0", series: [...emps.map(e => ({ nombreRef: nomIm(col(ubic[e.id] + 1)), cat, val: rIm(col(ubic[e.id] + 1)), color: COLORES[e.id] })), { nombreRef: nomIm("B"), cat, val: rIm("B"), color: "111111", ancho: 28575 }] }, 0, fg, 24, fg + 22); fg += 23;
    poner({ titulo: "Prima = implícito − CO1 (USD/bbl)", tipo: "line", fmtY: "0", series: emps.map(e => ({ nombreRef: nomIm(col(ubic[e.id] + 2)), cat, val: rIm(col(ubic[e.id] + 2)), color: COLORES[e.id] })) }, 0, fg, 24, fg + 20); fg += 21;
    const fCon = c => `Consistencia!$${c}$${filaG[emps[0].id]}:$${c}$${filaG["Total"]}`;
    poner({ titulo: "Proporción de desvíos que regresa vs. referencia sin reversión", tipo: "bar", fmtY: "0%", series: [["F", "1F3A4D"], ["G", "A9B7C0"], ["H", "D9730D"]].map(([c, cl]) => ({ nombreRef: `Consistencia!$${c}$${rA + 1}`, cat: fCon("A"), catTexto: true, val: fCon(c), color: cl })) }, 0, fg, 12, fg + 18);
    const Hc = H_.col, hR = c => `'Simulación'!$${c}$${H_.r0}:$${c}$${H_.r1}`, hN = c => `'Simulación'!$${c}$${H_.r0 - 1}`;
    poner({ titulo: "Referencia simulada: distribución de la proporción total (naranja: intervalo observado)", tipo: "bar", fmtY: "0", gap: 15, overlap: 100, series: [{ nombreRef: hN(Hc(4)), cat: hR(Hc(2)), catTexto: true, val: hR(Hc(4)), color: "D9730D" }, { nombreRef: hN(Hc(3)), cat: hR(Hc(2)), catTexto: true, val: hR(Hc(3)), color: "A9B7C0" }] }, 12, fg, 24, fg + 18); fg += 19;
    const cRs = `Resumen!$B$3:$${col(emps.length)}$3`, vRs = l => `Resumen!$B$${filaRs[l]}:$${col(emps.length)}$${filaRs[l]}`, nRs = l => `Resumen!$A$${filaRs[l]}`;
    poner({ titulo: "Prima: signo, magnitud y variabilidad (USD/bbl)", tipo: "bar", fmtY: "0", series: [["Prima media (signo)", "1F3A4D"], ["Prima media en valor absoluto (magnitud)", "6F9BB5"], ["Desvío estándar de la prima (variabilidad)", "D9730D"]].map(([l, cl]) => ({ nombreRef: nRs(l), cat: cRs, catTexto: true, val: vRs(l), color: cl })) }, 0, fg, 12, fg + 18);
    if (PARES.length) poner({ titulo: "Diferencia de prima entre pares de una misma región (USD/bbl)", tipo: "line", fmtY: "0", series: PARES.map(([a], j) => ({ nombreRef: nomIm(col(cPar0 + j - 1)), cat, val: rIm(col(cPar0 + j - 1)), color: COLORES[a] })) }, 12, fg, 24, fg + 18);
    fg += 19;
    const cTr = `Consistencia!$A$${rB0}:$A$${rB1}`;
    poner({ titulo: "Prima media por trimestre (USD/bbl)", tipo: "bar", fmtY: "0", gap: 40, series: emps.map((e, j) => ({ nombreRef: `Consistencia!$${col(3 + j)}$${rBc}`, cat: cTr, catTexto: true, val: `Consistencia!$${col(3 + j)}$${rB0}:$${col(3 + j)}$${rB1}`, color: COLORES[e.id] })) }, 0, fg, 24, fg + 18); fg += 19;
    emps.forEach((e, i) => { const q = RG[e.id], h = `'Rango ${e.id}'!`, rg = c => `${h}$${c}$${q.r0}:$${c}$${q.r1}`, nm = c => `${h}$${c}$4`, cC = (i % 3) * 8, fC = fg + Math.floor(i / 3) * 16;
      poner({ titulo: `${e.id}: prima, rango habitual y casos`, tipo: "line", fmtY: "0", mesesEje: 6, series: [{ nombreRef: nm("F"), cat: rg("A"), val: rg("F"), color: COLORES[e.id] }, { nombreRef: nm("G"), cat: rg("A"), val: rg("G"), color: "888888", ancho: 9525 }, { nombreRef: nm("I"), cat: rg("A"), val: rg("I"), color: "BBBBBB", ancho: 9525, guion: "dash" }, { nombreRef: nm("J"), cat: rg("A"), val: rg("J"), color: "BBBBBB", ancho: 9525, guion: "dash" }, { nombreRef: nm("W"), cat: rg("A"), val: rg("W"), color: "D62728", soloMarca: true }] }, cC, fC, cC + 8, fC + 15); });

    const orden = ["Leeme", "Dashboard", "Consistencia", "Implícitos", "Resumen", ...emps.map(e => e.id), ...emps.map(e => "Rango " + e.id), "Simulación", "Control"];
    orden.forEach((n, i) => { const w = wb.getWorksheet(n); if (w) w.orderNo = i; });
    wb.views = [{ activeTab: 1 }];
    const buf0 = await wb.xlsx.writeBuffer();
    avance("Agregando los gráficos…");
    const buf = await window.BICharts.inyectar(buf0, "Dashboard", gr);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = `brent-implicito_${desde}_${hasta}.xlsx`; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return { filas: fechas.length, empresas: emps.length, casos: oT.n, regresos: oT.reg, prop: oT.prop, umbral: umT, sens,
      maxDif: Math.max(0, ...emps.flatMap(e => Object.values(Di[e.id]).filter(d => d.web != null).map(d => Math.abs(d.xl - d.web)))) };
  }
  window.BIExcel = { exportar };
})();
