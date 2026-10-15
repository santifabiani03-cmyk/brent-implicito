/* Descarga a Excel: una hoja por empresa con los insumos de cada balance y el despeje con fórmulas,
   una hoja "Implícitos" con el Brent implícito diario (fórmula que lee las hojas de empresa) y el CO1,
   y hojas de resumen y control. El despeje usa la forma cerrada del motor (engine/model.py):
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
  const R = Object.fromEntries(ORDEN.map((k, i) => [k, F0 + i]));
  const C = { wacc: 33, q: 34, sh: 35, n: 36, rem: 37, v: 38, a: 39, m: 40, cb: 41, aj: 42, A: 43, B: 44, A0: 45, B0: 46, pk: 47, plano: 48 };
  const HEAD = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A4D" } } };
  const SUB = { font: { bold: true }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8EEF2" } } };

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

  // despeje en JS con la misma forma cerrada (para los valores en caché de las fórmulas)
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

  function hojaEmpresa(wb, e, cals, CAMPOS) {
    const ws = wb.addWorksheet(e.id, { views: [{ state: "frozen", xSplit: 2, ySplit: 4 }] });
    ws.getColumn(1).width = 44; ws.getColumn(2).width = 11;
    ws.getCell("A1").value = `${e.id} — ${e.nombre}: insumos de cada balance y despeje del Brent implícito`;
    ws.getCell("A1").font = { bold: true, size: 13 };
    ws.getCell("A2").value = "Una columna por balance (trimestre). Los insumos se pueden editar: el cálculo de abajo y la hoja Implícitos se recalculan solos.";
    ws.getCell("A2").font = { italic: true, color: { argb: "FF555555" } };
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
    filas.forEach(([f, lab, u, fx, clave, nf]) => {
      const fila = ws.getRow(f); fila.getCell(1).value = lab; fila.getCell(2).value = u;
      cals.forEach((cal, j) => { const c = col(2 + j); const cell = fila.getCell(3 + j);
        cell.value = { formula: fx(c), result: cal._k ? cal._k[clave] : undefined }; cell.numFmt = nf || "#,##0.00"; });
    });
    const fp = ws.getRow(C.plano); fp.getCell(1).value = "Perfil de producción plano (la forma cerrada vale)"; fp.getCell(2).value = "control";
    cals.forEach((cal, j) => { const c = col(2 + j);
      fp.getCell(3 + j).value = { formula: `IF(AND(${c}${R.crecimiento_anual}=0,${c}${R.declino_anual}=0),"OK","no plano: usar la web")`, result: "OK" }; });
    const o0 = C.plano + 2;
    ws.getCell(`A${o0}`).value = "Origen de cada dato"; Object.assign(ws.getCell(`A${o0}`), SUB);
    ORDEN.forEach((k, i) => { const fila = ws.getRow(o0 + 1 + i); fila.getCell(1).value = (CAMPOS[k] || [k])[0];
      cals.forEach((cal, j) => { const v = cal.inputs[k]; fila.getCell(3 + j).value = v ? (ORIGEN[v[1]] || v[1]) : "—"; }); });
    for (let j = 0; j < cals.length; j++) ws.getColumn(3 + j).width = 13;
  }

  async function exportar(D, opts) {
    const ExcelJS = await libreria();
    const { desde, hasta, empresas, CAMPOS } = opts;
    const hi = D.historia, wb = new ExcelJS.Workbook();
    wb.creator = "Barril Implícito — TIF Finanzas UADE"; wb.created = new Date();
    wb.calcProperties.fullCalcOnLoad = true;
    const emps = D.empresas.filter(e => empresas.includes(e.id) && hi.series[e.id] && hi.series[e.id].fecha.length);
    const co1 = Object.fromEntries(hi.brent_1l.fecha.map((f, i) => [f, hi.brent_1l.valor[i]]));
    // series diarias en rango y balances que las configuran
    const S = {}, CALS = {};
    emps.forEach(e => {
      const s = hi.series[e.id], idx = s.fecha.map((f, i) => i).filter(i => s.fecha[i] >= desde && s.fecha[i] <= hasta);
      const usados = new Set(idx.map(i => s.periodos[s.cal_idx[i]]));
      const cals = hi.calibraciones[e.id].filter(k => usados.has(k.periodo) && !k.faltan.length)
        .map(k => ({ ...k, _k: coef(Object.fromEntries(Object.entries(k.inputs).map(([a, b]) => [a, b[0]]))) }));
      CALS[e.id] = cals;
      const porP = Object.fromEntries(cals.map(k => [k.periodo, k._k]));
      S[e.id] = Object.fromEntries(idx.map(i => { const p = s.periodos[s.cal_idx[i]];
        return [s.fecha[i], { cap: s.cap_musd[i], bal: p, xl: porP[p] ? despeje(porP[p], s.cap_musd[i]) : null, web: s.implicito[i] }]; }));
    });
    const fechas = [...new Set([...emps.flatMap(e => Object.keys(S[e.id])), ...Object.keys(co1).filter(f => f >= desde && f <= hasta)])].sort();
    if (!fechas.length || !emps.length) throw new Error("no hay datos para ese rango y esas empresas");

    // --- Leeme
    const lm = wb.addWorksheet("Leeme");
    lm.getColumn(1).width = 120;
    [["Barril Implícito — Brent implícito en la capitalización bursátil", { bold: true, size: 14 }],
     [`Generado: ${new Date().toLocaleString("es-AR")} · Rango: ${desde} a ${hasta} · Empresas: ${emps.map(e => e.id).join(", ")}`],
     [`Datos: serie de la web actualizada al ${(hi.actualizado || "").slice(0, 10)}. Estados contables: Bloomberg (terminal UADE) con EDGAR/releases para operativos (ver hoja de cada empresa, "Origen de cada dato").`],
     [""],
     ["Hojas", { bold: true }],
     ["• Una hoja por empresa: insumos de cada balance (una columna por trimestre, rige desde su fecha de publicación) y el cálculo con fórmulas."],
     ["• Implícitos: por día, CO1, y para cada empresa la capitalización (MUSD), el balance vigente, el Brent implícito (fórmula) y la prima = implícito − CO1."],
     ["• Resumen: signo, magnitud (media del valor absoluto) y variabilidad (desvío) de la prima en el rango, por empresa (objetivo a)."],
     ["• Control: diferencia entre el implícito que calcula este Excel y el de la web (motor por bisección). Debe ser ≈ 0."],
     [""],
     ["Método (forma cerrada del motor)", { bold: true }],
     ["Producción plana Q hasta agotar las reservas probadas (máx. 30 años), flujos a mitad de año descontados al WACC → volumen descontado V."],
     ["Valor del patrimonio = A·P + B, con A = V·a·(1−t) y B = V·(m·(1−t) + t·DD&A − capex/boe) + no-upstream − deuda neta − minoritarios."],
     ["Brent implícito P* = (capitalización − B) / A. Si P* < Pk (base imponible negativa), se usa el tramo sin impuesto: P* = (capitalización − B0) / A0."],
     ["a = participación del crudo × (1 − diferencial) × (1 − regalías − retenciones); m = margen por boe sin crudo (gas/NGL a precio fijo − lifting − otros costos)."],
     [""],
     ["CO1 (Brent, primer futuro ICE)", { bold: true }],
     ["Cierre diario de Yahoo Finance BZ=F (primer contrato ICE Brent) como proxy del CO1 Comdty de Bloomberg: el archivo del CO1 bajado de la terminal vino vacío."],
     ["La prima usa el CO1 del mismo día; los días sin cotización de alguna de las dos quedan en blanco."],
     [""],
     ["Los insumos son editables: cambiar un valor en la hoja de una empresa recalcula su implícito en todas las fechas que rige ese balance."],
    ].forEach(([t, f], i) => { const c = lm.getCell(`A${i + 1}`); c.value = t; if (f) c.font = f; c.alignment = { wrapText: true }; });

    // --- hojas por empresa
    emps.forEach(e => hojaEmpresa(wb, e, CALS[e.id], CAMPOS));

    // --- Implícitos
    const im = wb.addWorksheet("Implícitos", { views: [{ state: "frozen", xSplit: 2, ySplit: 4 }] });
    im.getCell("A1").value = "Brent implícito diario por empresa y CO1"; im.getCell("A1").font = { bold: true, size: 13 };
    im.getCell("A2").value = "Implícito = fórmula sobre la hoja de cada empresa (balance vigente ese día). Prima = implícito − CO1, en USD/bbl.";
    im.getCell("A2").font = { italic: true, color: { argb: "FF555555" } };
    const cab = ["Fecha", "CO1 (USD/bbl)"], ubic = {};
    emps.forEach((e, j) => { const c0 = 3 + 4 * j; ubic[e.id] = c0;
      cab.push(`${e.id} cap. (MUSD)`, `${e.id} balance`, `${e.id} implícito`, `${e.id} prima`); });
    im.getRow(4).values = cab; im.getRow(4).eachCell(c => Object.assign(c, HEAD)); im.getRow(4).alignment = { wrapText: true, vertical: "middle" };
    im.getRow(4).height = 30; im.getColumn(1).width = 11; im.getColumn(2).width = 10;
    fechas.forEach((f, i) => {
      const r = 5 + i, fila = im.getRow(r);
      fila.getCell(1).value = fechaXL(f); fila.getCell(1).numFmt = "dd/mm/yyyy";
      if (co1[f] != null) { fila.getCell(2).value = co1[f]; fila.getCell(2).numFmt = "0.00"; }
      emps.forEach(e => {
        const c0 = ubic[e.id], d = S[e.id][f], cC = col(c0 - 1), cB = col(c0), cI = col(c0 + 1);
        if (!d) return;
        const rng = fr => `'${e.id}'!$C$${fr}:$Z$${fr}`, k = `MATCH(${cB}${r},'${e.id}'!$C$4:$Z$4,0)`;
        const p1 = `(${cC}${r}-INDEX(${rng(C.B)},${k}))/INDEX(${rng(C.A)},${k})`;
        fila.getCell(c0).value = d.cap; fila.getCell(c0).numFmt = "#,##0";
        fila.getCell(c0 + 1).value = d.bal;
        fila.getCell(c0 + 2).value = { formula: `IF(OR(${cC}${r}="",${cB}${r}=""),"",IF(${p1}<INDEX(${rng(C.pk)},${k}),(${cC}${r}-INDEX(${rng(C.B0)},${k}))/INDEX(${rng(C.A0)},${k}),${p1}))`,
          result: d.xl == null ? "" : d.xl };
        fila.getCell(c0 + 2).numFmt = "0.00";
        fila.getCell(c0 + 3).value = { formula: `IF(OR(${cI}${r}="",$B${r}=""),"",${cI}${r}-$B${r})`,
          result: d.xl != null && co1[f] != null ? d.xl - co1[f] : "" };
        fila.getCell(c0 + 3).numFmt = "0.00";
      });
    });
    emps.forEach(e => { const c0 = ubic[e.id]; [11, 9, 10, 9].forEach((w, k) => im.getColumn(c0 + k).width = w); });
    const ult = 4 + fechas.length;

    // --- Control
    const ct = wb.addWorksheet("Control", { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
    ct.getCell("A1").value = "Control: implícito de este Excel vs. implícito de la web (motor por bisección, tolerancia 0,005)"; ct.getCell("A1").font = { bold: true };
    ct.getRow(4).values = ["Fecha", ...emps.flatMap(e => [`${e.id} web`, `${e.id} Excel − web`])];
    ct.getRow(4).eachCell(c => Object.assign(c, HEAD)); ct.getColumn(1).width = 11;
    fechas.forEach((f, i) => {
      const r = 5 + i, fila = ct.getRow(r); fila.getCell(1).value = fechaXL(f); fila.getCell(1).numFmt = "dd/mm/yyyy";
      emps.forEach((e, j) => { const d = S[e.id][f]; if (!d || d.web == null) return;
        const cw = 2 + 2 * j, ci = col(ubic[e.id] + 1), cwL = col(cw - 1);
        fila.getCell(cw).value = d.web; fila.getCell(cw).numFmt = "0.00";
        fila.getCell(cw + 1).value = { formula: `IF('Implícitos'!${ci}${r}="","",'Implícitos'!${ci}${r}-${cwL}${r})`, result: d.xl == null ? "" : d.xl - d.web };
        fila.getCell(cw + 1).numFmt = "0.000"; });
    });

    // --- Resumen
    const rs = wb.addWorksheet("Resumen");
    rs.getCell("A1").value = `Prima = implícito − CO1 (USD/bbl), del ${desde} al ${hasta}`; rs.getCell("A1").font = { bold: true, size: 13 };
    const met = [["Días con implícito", c => `COUNT(${c})`, "0", "i"], ["Implícito medio", c => `AVERAGE(${c})`, "0.00", "i"],
      ["Días con prima", c => `COUNT(${c})`, "0", "p"], ["Prima media (signo)", c => `AVERAGE(${c})`, "0.00", "p"],
      ["Prima media en valor absoluto (magnitud)", c => `(SUMIF(${c},">0")-SUMIF(${c},"<0"))/COUNT(${c})`, "0.00", "p"],
      ["Desvío estándar de la prima (variabilidad)", c => `STDEV(${c})`, "0.00", "p"], ["Prima mínima", c => `MIN(${c})`, "0.00", "p"],
      ["Prima máxima", c => `MAX(${c})`, "0.00", "p"], ["% de días con prima positiva", c => `COUNTIF(${c},">0")/COUNT(${c})`, "0%", "p"],
      ["Balances usados", null, "0", "n"], ["Control: máx. |Excel − web|", null, "0.000", "c"]];
    rs.getRow(3).values = ["Métrica", ...emps.map(e => e.id)]; rs.getRow(3).eachCell(c => Object.assign(c, HEAD)); rs.getColumn(1).width = 44;
    met.forEach(([lab, fx, nf, q], i) => {
      const fila = rs.getRow(4 + i); fila.getCell(1).value = lab;
      emps.forEach((e, j) => {
        const cell = fila.getCell(2 + j); cell.numFmt = nf; rs.getColumn(2 + j).width = 12;
        const ci = col(ubic[e.id] + (q === "i" ? 1 : 2));
        if (q === "n") cell.value = CALS[e.id].length;
        else if (q === "c") { const cd = col(2 + 2 * j); cell.value = { formula: `MAX(MAX(Control!${cd}5:${cd}${ult}),-MIN(Control!${cd}5:${cd}${ult}))` }; }
        else cell.value = { formula: fx(`'Implícitos'!${ci}5:${ci}${ult}`) };
      });
    });

    wb.worksheets.forEach(w => w.state = "visible");
    // orden: Leeme, Implícitos, Resumen, empresas, Control
    const orden = ["Leeme", "Implícitos", "Resumen", ...emps.map(e => e.id), "Control"];
    orden.forEach((n, i) => { const w = wb.getWorksheet(n); if (w) w.orderNo = i; });
    const buf = await wb.xlsx.writeBuffer();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = `brent-implicito_${desde}_${hasta}.xlsx`; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    return { filas: fechas.length, empresas: emps.length, maxDif: Math.max(0, ...emps.flatMap(e => Object.values(S[e.id]).filter(d => d.xl != null && d.web != null).map(d => Math.abs(d.xl - d.web)))) };
  }
  window.BIExcel = { exportar, coef, despeje };
})();
