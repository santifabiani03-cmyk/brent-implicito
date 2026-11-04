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
  const X0 = 26;      // primera columna (1-based) de la matriz prima/media/desvío/ρ por balance en las hojas Rango
  const HOLGURA = 20; // ruedas extra de la matriz: permiten mover una fecha de publicación sin salir de lo calculado
  const BANDAS = [1.5, 1.75, 2, 2.25, 2.5];   // bandas con referencia simulada al exportar: las que ofrece la celda de desvíos
  const CB = { t: 77, bM: 78, b0M: 79, pM: 80, bP: 81, b0P: 82, pP: 83, imp: 84, min: 85, max: 86, fuera: 87 };   // banda de sensibilidad (8.3) en las hojas de empresa
  const CN = { t: 89, seg: 90, e12: 91, base: 92, fd: 93, val: 94, cap: 95, rat: 96 };                            // valor no upstream (7.4) en las integradas
  const PBANDA = { w: "Banda!$B$2", c: "Banda!$D$2" };
  const BK = 15;      // columnas por empresa en la hoja Banda: 6 a la vista y 9 de cálculo
  const colB = (j, d) => col(2 + BK * j + d);
  // segmentos que entran al EBITDA no upstream: la definición de cada empresa, ver inputs/bloomberg/<ID>_notas.md
  const SEGMENTOS = { YPF: "Midstream y Downstream + GNL y Gas Integrado + Nuevas Energías (antes: Downstream + Gas y Energía). Sin Administración Central",
    SU: "Refining & Marketing. Sin Corporate & Eliminations", PBR: "Refino, Transporte y Comercialización + Gas y Energías de Baja Emisión" };

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

  function hojaEmpresa(wb, e, cals, CAMPOS, ext) {
    const ws = wb.addWorksheet(e.id, { views: [{ state: "frozen", xSplit: 2, ySplit: 4 }] });
    ws.getColumn(1).width = 44; ws.getColumn(2).width = 11;
    ws.getCell("A1").value = `${e.id} — ${e.nombre}: insumos de cada balance y despeje del Brent implícito`;
    ws.getCell("A1").font = { bold: true, size: 13 };
    ws.getCell("A2").value = "Una columna por balance (trimestre). Los insumos se pueden editar: el cálculo de abajo, la hoja Implícitos, Consistencia y el Dashboard se recalculan solos.";
    Object.assign(ws.getCell("A2"), GRIS);
    ws.getRow(4).values = ["Variable", "Unidad", ...cals.map(k => k.periodo)];
    ws.getRow(5).values = ["Publicado (rige desde)", "fecha", ...cals.map(k => fechaXL(k.publicado))];
    ws.getRow(4).eachCell((c, i) => { Object.assign(c, HEAD); if (i > 2) c.numFmt = "@"; });
    ws.getRow(5).eachCell((c, i) => { if (i > 2) c.numFmt = "dd/mm/yyyy"; });
    ORDEN.forEach((k, i) => {
      const fila = ws.getRow(F0 + i), pct = (CAMPOS[k] || [])[1]?.startsWith("%");
      fila.getCell(1).value = (CAMPOS[k] || [k])[0]; fila.getCell(2).value = (CAMPOS[k] || [k, ""])[1];
      cals.forEach((cal, j) => { const c = fila.getCell(3 + j), v = cal.inputs[k], e12 = k === "valor_no_upstream_musd" && cal.inputs.ebitda_no_up_12m_musd?.[0], L = col(2 + j);
        // refinación (7.4): EBITDA de 12 meses × (1 − impuesto) × factor de descuento, con el WACC y el horizonte de esta misma columna
        c.value = e12 ? fx(`${L}${CN.e12}*(1-${L}${R_.tasa_impuesto})*${L}${C.v}/${L}${C.q}`, v[0]) : (v ? v[0] : null); c.numFmt = pct ? "0.00%" : "#,##0.00"; });
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
    // banda de sensibilidad (8.3): los costos cambian B, B0 y Pk; el WACC ± se aplica rueda a rueda en la hoja Banda
    const S = window.BIStats, jB = ext.j, rg = d => `Banda!$${colB(jB, d)}$5:$${colB(jB, d)}$${ext.ult}`, rgNb = rg(6);
    ws.getCell(`A${CB.t}`).value = "Banda de sensibilidad (8.3): coeficientes con costos ±. El WACC ± se aplica rueda a rueda en la hoja Banda"; Object.assign(ws.getCell(`A${CB.t}`), SUB);
    const cst = c => `(${c}${R.lifting_usd_boe}+${c}${R.otros_costos_usd_boe})`, dVal = (c, s1) => `${s1}${c}${C.v}*${PBANDA.c}*${cst(c)}`;
    [[CB.bM, "B con costos −", "MUSD", c => `${c}${C.B}${dVal(c, "+")}*(1-${c}${R.tasa_impuesto})`, -1, "B"], [CB.b0M, "B0 con costos −", "MUSD", c => `${c}${C.B0}${dVal(c, "+")}`, -1, "B0"], [CB.pM, "Pk con costos −", "USD/bbl", c => `${c}${C.pk}-${PBANDA.c}*${cst(c)}/${c}${C.a}`, -1, "pk"],
     [CB.bP, "B con costos +", "MUSD", c => `${c}${C.B}${dVal(c, "-")}*(1-${c}${R.tasa_impuesto})`, 1, "B"], [CB.b0P, "B0 con costos +", "MUSD", c => `${c}${C.B0}${dVal(c, "-")}`, 1, "B0"], [CB.pP, "Pk con costos +", "USD/bbl", c => `${c}${C.pk}+${PBANDA.c}*${cst(c)}/${c}${C.a}`, 1, "pk"]]
      .forEach(([f, lab, u, fm, sg, cl]) => { const fila = ws.getRow(f); fila.getCell(1).value = lab; fila.getCell(2).value = u;
        cals.forEach((cal, j) => { const c = col(2 + j), cell = fila.getCell(3 + j); cell.value = fx(fm(c), S.coef(S.conCostos(cal._x, sg * S.BANDA.costos))[cl]); cell.numFmt = "#,##0.00"; }); });
    [[CB.imp, "Implícito medio con este balance, en el rango", "USD/bbl", 0, "imp"], [CB.min, "Banda: mínimo medio", "USD/bbl", 1, "min"], [CB.max, "Banda: máximo medio", "USD/bbl", 2, "max"], [CB.fuera, "Ruedas con el CO1 fuera de la banda", "%", 5, "fuera", "0%"]]
      .forEach(([f, lab, u, d, cl, nf]) => { const fila = ws.getRow(f); fila.getCell(1).value = lab; fila.getCell(2).value = u;
        cals.forEach((cal, j) => { const cell = fila.getCell(3 + j), v = ext.porBal[cal.periodo]?.[cl];
          cell.value = fx(`IFERROR(AVERAGEIF(${rgNb},${j + 1},${rg(d)}),"")`, v ?? ""); cell.numFmt = nf || "#,##0.00"; }); });
    // valor no upstream (7.4), solo en las integradas
    if (cals.some(k => k.inputs.ebitda_no_up_12m_musd?.[0])) {
      const hR = `'Rango ${e.id}'!`, rc = l => `${hR}$${l}$5:$${l}$${4 + ext.n}`;
      ws.getCell(`A${CN.t}`).value = "Valor no upstream (7.4): EBITDA de 12 meses × (1 − impuesto) × V/Q, sin múltiplo ni valor terminal"; Object.assign(ws.getCell(`A${CN.t}`), SUB);
      ws.getCell(`A${CN.seg}`).value = "Segmentos incluidos: " + (SEGMENTOS[e.id] || "—"); Object.assign(ws.getCell(`A${CN.seg}`), GRIS);
      const fi = { [CN.e12]: ["EBITDA de 12 meses de esos segmentos (editable)", "MUSD"], [CN.base]: ["Base del EBITDA", "—"], [CN.fd]: ["Factor de descuento V/Q (años equivalentes)", "años"],
        [CN.val]: ["Valor no upstream que entra en B", "MUSD"], [CN.cap]: ["Capitalización media mientras rige el balance", "MUSD"], [CN.rat]: ["Valor no upstream / capitalización", "%"] };
      Object.entries(fi).forEach(([f, [lab, u]]) => { ws.getCell(+f, 1).value = lab; ws.getCell(+f, 2).value = u; });
      cals.forEach((cal, j) => { const c = col(2 + j), cc = 3 + j, q = ext.porBal[cal.periodo] || {}, n_ = cal.ebitda_trimestres;
        ws.getCell(CN.e12, cc).value = cal.inputs.ebitda_no_up_12m_musd?.[0] ?? null; ws.getCell(CN.e12, cc).numFmt = "#,##0.00";
        ws.getCell(CN.base, cc).value = n_ === 4 ? "12 meses" : n_ ? `${n_} trim. anualizados` : "—"; ws.getCell(CN.base, cc).alignment = { wrapText: true };
        ws.getCell(CN.fd, cc).value = fx(`${c}${C.v}/${c}${C.q}`, cal._k.V / cal._k.Q); ws.getCell(CN.fd, cc).numFmt = "0.00";
        ws.getCell(CN.val, cc).value = fx(`${c}${R.valor_no_upstream_musd}`, cal.inputs.valor_no_upstream_musd?.[0]); ws.getCell(CN.val, cc).numFmt = "#,##0.00";
        ws.getCell(CN.cap, cc).value = fx(`IFERROR(AVERAGEIF(${rc("E")},${j + 1},${rc("C")}),"")`, q.cap ?? ""); ws.getCell(CN.cap, cc).numFmt = "#,##0";
        ws.getCell(CN.rat, cc).value = fx(`IFERROR(${c}${CN.val}/${c}${CN.cap},"")`, q.cap ? cal.inputs.valor_no_upstream_musd?.[0] / q.cap : ""); ws.getCell(CN.rat, cc).numFmt = "0%"; });
    }
    for (let j = 0; j < cals.length; j++) ws.getColumn(3 + j).width = 13;
  }

  /* Hoja de cálculo del rango habitual: todo con fórmulas sobre la hoja de la empresa. */
  function hojaRango(wb, e, ev, cfg, im) {
    const ws = wb.addWorksheet("Rango " + e.id, { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
    const K = e.cals.length, n = e.n, f0 = 5, S = window.BIStats;
    const lastCol = col(X0 - 1 + 4 * K - 1), MAT = `$${col(X0 - 1)}$${f0}:$${lastCol}$${f0 + n - 1}`;
    ws.getCell("A1").value = `${e.id}: rango habitual y casos (6.1). Fórmulas conectadas a la hoja ${e.id} y a los parámetros de Consistencia.`; ws.getCell("A1").font = { bold: true, size: 12 };
    ws.getCell("A2").value = "A la derecha, prima/media/desvío con los parámetros de cada balance y el riesgo país de cada rueda (columna Y): la ventana (20 ruedas previas) se recalcula con el balance vigente y cada caso se evalúa con el del día del desvío. ρ = volumen descontado con el WACC del día / con el WACC del balance.";
    Object.assign(ws.getCell("A2"), GRIS);
    const cab = ["Fecha", "CO1", "Cap. (MUSD)", "Balance", "n.º bal.", "Prima", "Media 20", "Desvío 20", "Inferior", "Superior", "Fuera", "Inicio caso", "d0", "Signo", "Fin eval.", "Ruedas que cumplen", "Regresó", "Ruedas hasta regreso", "Cruza balance", "Δ prima (mismo bal.)", "Prima t−1", "Δ prima t−1", "Marca caso", "Caso n.º", "Riesgo país"];
    e.cals.forEach(k => cab.push(`Prima|${k.periodo}`, `Media|${k.periodo}`, `Desvío|${k.periodo}`, `ρ|${k.periodo}`));
    ws.getRow(4).values = cab; ws.getRow(4).eachCell(c => Object.assign(c, HEAD)); ws.getRow(4).alignment = { wrapText: true, vertical: "middle" }; ws.getRow(4).height = 42;
    ws.getColumn(1).width = 11; ws.getColumn(4).width = 11;
    const porT = Object.fromEntries(ev.casos.map(c => [c.t, c])), vigente = balanceVigente(e.id, K);
    let nCaso = 0;
    for (let t = 0; t < n; t++) {
      const r = f0 + t, pos = t + 1, fila = ws.getRow(r), k = e.kIdx[t], enRango = t >= e.i0 && t <= e.i1, conRango = t >= S.VENTANA;
      const c1 = `4*($E${r}-1)+1`, kP = S.primaK(e, k), { m, s } = S.rangoK(e, k);
      fila.getCell(1).value = fechaXL(e.fechas[t]); fila.getCell(1).numFmt = "dd/mm/yyyy";
      fila.getCell(25).value = e.crp[t]; fila.getCell(25).numFmt = "0.00%";
      // en el rango elegido, el mercado se edita en Implícitos; afuera (ventana y evaluación) solo existe acá
      const rI = enRango && im.tiene(e.fechas[t]) ? im.fila[e.fechas[t]] : null;
      fila.getCell(2).value = rI ? fx(`'Implícitos'!$B$${rI}`, e.co1[t]) : e.co1[t]; fila.getCell(2).numFmt = "0.00";
      fila.getCell(3).value = rI ? fx(`'Implícitos'!$${im.cap}$${rI}`, e.cap[t]) : e.cap[t]; fila.getCell(3).numFmt = "#,##0";
      fila.getCell(4).value = fx(vigente(`$A${r}`), e.bal[t]);
      fila.getCell(5).value = fx(`MATCH(D${r},'${e.id}'!$C$4:$Z$4,0)`, k + 1);
      // celda vacía = fecha de publicación movida más allá de lo calculado: error visible, no un 0 silencioso
      const leer = d => `IF(INDEX(${MAT},${pos},${c1}+${d})="",NA(),INDEX(${MAT},${pos},${c1}+${d}))`;
      fila.getCell(6).value = fx(leer(0), kP[t]); fila.getCell(6).numFmt = "0.00";
      if (conRango) {
        fila.getCell(7).value = fx(leer(1), m[t]); fila.getCell(8).value = fx(leer(2), s[t]);
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
        if (c) nCaso++;
        fila.getCell(24).value = fx(`N(X${r - 1})+L${r}`, nCaso);
      }
      if (enRango && t >= 1) {
        fila.getCell(20).value = fx(`INDEX(${MAT},${pos},${c1})-INDEX(${MAT},${pos - 1},${c1})`, kP[t] - kP[t - 1]);
        fila.getCell(21).value = fx(`INDEX(${MAT},${pos - 1},${c1})`, kP[t - 1]);
        if (t - 1 >= e.i0 && t - 1 >= 1) { const kp = S.primaK(e, e.kIdx[t - 1]); fila.getCell(22).value = fx(`T${r - 1}`, kp[t - 1] - kp[t - 2]); }
        [20, 21, 22].forEach(c => fila.getCell(c).numFmt = "0.00");
      }
    }
    e.cals.forEach((cal, k) => {       // matriz: cuatro columnas por balance, solo donde hace falta (ventana + vigencia + evaluación)
      const cP = X0 + 4 * k, lP = col(cP - 1), hoja = `'${e.id}'!`, cb = col(2 + k), P = S.primaK(e, k), { m, s } = S.rangoK(e, k), lR = col(cP + 2);
      const cel = f => `${hoja}${cb}$${f}`, deuda = `(${cel(R_.deuda_neta_musd)}+${cel(R_.minoritarios_musd)})`;
      const a0 = Math.max(0, e.primero[k] - S.VENTANA - HOLGURA), a1 = Math.min(n - 1, e.ultimo[k] + 15 + HOLGURA);
      for (let t = a0; t <= a1; t++) {
        // WACC del día (7.4). A y B + deuda son proporcionales al volumen descontado, también con la refinación por flujos: basta ρ
        const r = f0 + t, fila = ws.getRow(r), w = `(${cel(C.wacc)}+(1-${cel(R_.peso_deuda)})*${cel(R_.lambda_crp)}*($Y${r}-${cel(R_.crp)}))`, rho = `$${lR}${r}`;
        const vol = `${cel(C.q)}*(1+${w})^0.5*(1-(1+${w})^(-${cel(C.n)}))/${w}+${cel(C.rem)}*(1+${w})^(-(${cel(C.n)}+0.5))`;
        fila.getCell(cP + 3).value = fx(`(${vol})/${cel(C.v)}`, S.coef({ ...cal._x, crp: e.crp[t] }).V / cal._k.V); fila.getCell(cP + 3).numFmt = "0.0000";
        const p1 = `($C${r}+${deuda}-(${cel(C.B)}+${deuda})*${rho})/(${cel(C.A)}*${rho})`, p0 = `($C${r}+${deuda}-(${cel(C.B0)}+${deuda})*${rho})/(${cel(C.A0)}*${rho})`;
        fila.getCell(cP).value = fx(`IF(${p1}<${cel(C.pk)},${p0},${p1})-$B${r}`, P[t]);
        fila.getCell(cP).numFmt = "0.00";
        if (t >= S.VENTANA && t >= e.primero[k] - HOLGURA) {
          fila.getCell(cP + 1).value = fx(`AVERAGE(${lP}${r - 20}:${lP}${r - 1})`, m[t]); fila.getCell(cP + 2).value = fx(`STDEV(${lP}${r - 20}:${lP}${r - 1})`, s[t]);
          fila.getCell(cP + 1).numFmt = fila.getCell(cP + 2).numFmt = "0.00";
        }
      }
    });
    return { f0, n, r0: f0 + Math.max(e.i0, S.VENTANA), r1: f0 + e.i1 };
  }

  /* Balance vigente en una fecha: el último publicado hasta ese día (6.1). Recorre las columnas, así no depende de que estén ordenadas. */
  const balanceVigente = (id, K) => f => `LOOKUP(2,1/('${id}'!$C$5:$${col(1 + K)}$5<=${f}),'${id}'!$C$4:$${col(1 + K)}$4)`;

  /* Referencia simulada: una fila por corrida, con la proporción de regresos de cada grupo (fuente de los percentiles de Consistencia). */
  function hojaSimulacion(wb, emps, grupos, bandas, base, N, seed, sens, RG, filaTot, CF) {
    const ws = wb.addWorksheet("Simulación", { views: [{ state: "frozen", ySplit: 24 }] }), S = window.BIStats;
    ws.getCell("A1").value = "Referencia simulada sin reversión (6.1 y 7.7)"; ws.getCell("A1").font = { bold: true, size: 13 };
    ["Cada corrida aplica la misma regla a una prima simulada: CO1 OBSERVADO menos un Brent implícito sin reversión, de modo que los regresos debidos al propio CO1 quedan en la referencia.",
     "Cambio diario del implícito = β·ΔCO1 + u. β y u salen de los cambios diarios observados con un mismo balance; u se remuestrea por fecha y en conjunto entre empresas, lo que conserva volatilidad y correlación y elimina la autocorrelación.",
     "Desfase horario remanente: sin historia intradiaria del CO1 (8.4), el ruido de cierre se mide con la autocovarianza de primer orden de u, σε² = máx(0, −cov(u_t, u_t−1)), y se suma como error i.i.d. sobre el nivel; la varianza del paseo aleatorio se reduce en 2σε².",
     `${N} corridas por banda; semilla ${seed}; ${base.nPool} fechas en el remuestreo conjunto. Estos valores se calculan al exportar: la celda de desvíos de Consistencia elige qué bloque se usa. Si se editan datos o insumos, no se recalculan y Consistencia lo avisa.`]
      .forEach((t, i) => { ws.getCell(`A${3 + i}`).value = t; Object.assign(ws.getCell(`A${3 + i}`), GRIS); });
    ws.getRow(8).values = ["Calibración", "β (ΔCO1)", "Vol. diaria u (USD/bbl)", "Autocorr. u (1)", "σε ruido (USD/bbl)"]; [1, 2, 3, 4, 5].forEach(c => Object.assign(ws.getCell(8, c), HEAD));
    ws.getRow(8).alignment = { wrapText: true, vertical: "middle" };
    emps.forEach((e, i) => { const f = ws.getRow(9 + i); f.getCell(1).value = e.id; [e.sim.beta, e.sim.volU, e.sim.ac1, e.sim.sigEps].forEach((v, k) => { f.getCell(2 + k).value = v; f.getCell(2 + k).numFmt = "0.000"; }); });
    // Un bloque de columnas por banda, en la misma matriz: la celda de desvíos elige el bloque con INDEX
    const f0 = 25, fN = f0 + N - 1, nG = grupos.length, zTxt = z => String(z).replace(".", ",");
    ws.getRow(24).values = ["Corrida", ...bandas.flatMap(b => grupos.map(g => `${g.nombre} ±${zTxt(b.z)}`))]; ws.getRow(24).eachCell(c => Object.assign(c, HEAD));
    const todas = bandas.map(b => grupos.map(g => b.corridas.map(c => S.propSim(c, emps, g.ids)))), iP = bandas.findIndex(b => b.z === S.PRINCIPAL.z), props = todas[iP];
    for (let i = 0; i < N; i++) { const f = ws.getRow(f0 + i); f.getCell(1).value = i + 1; todas.forEach((pb, k) => grupos.forEach((g, j) => { const v = pb[j][i]; if (v != null) { const x = f.getCell(2 + k * nG + j); x.value = v; x.numFmt = "0.0%"; } })); }
    ws.getColumn(1).width = 14; for (let c = 2; c <= 1 + nG * bandas.length; c++) ws.getColumn(c).width = 12;
    // corridas de cada sensibilidad: permiten que el panel E siga al percentil
    const cS = 2 + nG * bandas.length, colSens = i => `'Simulación'!$${col(cS - 1 + i)}$${f0}:$${col(cS - 1 + i)}$${f0 + sens[i].sim.length - 1}`;
    sens.forEach((x, i) => { const h = ws.getCell(24, cS + i); h.value = `Sens. ${i + 1}: ${x.nombre}`; Object.assign(h, HEAD); ws.getColumn(cS + i).width = 12;
      x.sim.forEach((v, q) => { const c = ws.getCell(f0 + q, cS + i); c.value = v; c.numFmt = "0.0%"; }); });
    const rZ = 9 + emps.length + 1, rE = rZ + 1 + bandas.length, listaZ = `$A$${rZ + 1}:$A$${rE - 1}`, matriz = `$B$${f0}:$${col(nG * bandas.length)}$${fN}`;
    ws.getCell(rZ, 1).value = "Bandas simuladas"; Object.assign(ws.getCell(rZ, 1), HEAD);
    bandas.forEach((b, k) => { ws.getCell(rZ + 1 + k, 1).value = b.z; });
    ws.getCell(rE, 1).value = "Bloque elegido"; ws.getCell(rE, 2).value = fx(`IFERROR(MATCH(Consistencia!$C$7,${listaZ},0),0)`, iP + 1);
    const columna = (g, h = "") => `INDEX(${h}${matriz},0,(${h}$B$${rE}-1)*${nG}+${g + 1})`;
    // control: si cambian los datos con los que se simuló, la referencia ya no es la de esos datos
    ["Empresa", "Datos al exportar", "Datos actuales", "Casos previos"].forEach((t, c) => { const x = ws.getCell(8, 7 + c); x.value = t; Object.assign(x, HEAD); });
    const suma = a => a.reduce((x, y) => x + y, 0), rD = 9 + emps.length, serial = f => Date.parse(f + "T00:00:00Z") / 864e5 + 25569;
    emps.forEach((e, i) => { const r = 9 + i, K = e.cals.length, u = col(1 + K), rg = c => `'Rango ${e.id}'!$${c}$${RG[e.id].f0}:$${c}$${RG[e.id].f0 + RG[e.id].n - 1}`;
      const val = suma(e.co1) + suma(e.cap) + suma(e.crp) + suma(e.cals.map(k => k._k.A + k._k.B + k._k.A0 + k._k.B0 + k._k.pk + serial(k.publicado)));
      ws.getCell(r, 7).value = e.id; ws.getCell(r, 8).value = val;
      ws.getCell(r, 9).value = fx(`SUM(${rg("B")})+SUM(${rg("C")})+SUM(${rg("Y")})+SUM('${e.id}'!$C$${C.A}:$${u}$${C.pk})+SUM('${e.id}'!$C$5:$${u}$5)`, val);
      ws.getCell(r, 10).value = i ? fx(`IFERROR(SUM(Consistencia!$B$${filaTot - nG + 1}:$B$${filaTot - nG + i}),0)`, suma(emps.slice(0, i).map(x => x.ev.casos.length))) : 0; });
    const rF = rD + 1, previos = `'Simulación'!$J$9:$J$${rD - 1}`, nombres = `'Simulación'!$G$9:$G$${rD - 1}`;
    ws.getCell(rF, 7).value = "Datos editados"; ws.getCell(rF, 8).value = fx(`IFERROR(IF(SUMPRODUCT(--(ABS(H9:H${rD - 1}-I9:I${rD - 1})>0.001))>0,1,0),0)`, 0);
    ws.getCell(rF + 1, 7).value = "Perfil no plano"; ws.getCell(rF + 1, 8).value = fx(emps.map(e => `COUNTIF('${e.id}'!$C$${C.plano}:$Z$${C.plano},"no plano*")`).join("+"), 0);
    ws.getCell(rF + 2, 7).value = "Referencia aplicable"; ws.getCell(rF + 2, 8).value = fx(`IFERROR(IF(OR(ISERROR(Consistencia!$B$${filaTot}),$B$${rE}=0,Consistencia!$C$8<>${CF.plazo},ABS(Consistencia!$C$9-${CF.rec})>=0.000001),0,1),0)`, 1);
    // histograma de la proporción total (alimenta el gráfico del Dashboard); los intervalos cubren todas las bandas
    const cH = 3 + nG + 1, L = i => col(cH - 1 + i), rH = 8;
    ["Desde", "Hasta", "Intervalo", "Simulaciones", "Observada"].forEach((t, c) => { const x = ws.getCell(rH, cH + c); x.value = t; Object.assign(x, HEAD); });
    const tot = props[nG - 1].filter(v => v != null), ext = [...todas.flatMap(pb => pb[nG - 1].filter(v => v != null)), ...bandas.map(b => b.obs).filter(Number.isFinite)], mn = Math.floor(Math.min(...ext) * 25) / 25, nb = Math.min(15, Math.ceil((Math.max(...ext) - mn) / .04) + 1);
    const borde = i => Math.round((mn + i * .04) * 100) / 100, cuentas = Array.from({ length: nb }, (_, i) => tot.filter(v => v >= borde(i) && v < borde(i + 1)).length), mx = Math.max(...cuentas);
    for (let i = 0; i < nb; i++) {
      const r = rH + 1 + i, a = borde(i), b = borde(i + 1), rng = columna(nG - 1);
      ws.getCell(r, cH).value = a; ws.getCell(r, cH + 1).value = b; ws.getCell(r, cH).numFmt = ws.getCell(r, cH + 1).numFmt = "0%";
      ws.getCell(r, cH + 2).value = fx(`TEXT(${L(0)}${r},"0%")&"–"&TEXT(${L(1)}${r},"0%")`, `${Math.round(a * 100)}%–${Math.round(b * 100)}%`);
      ws.getCell(r, cH + 3).value = fx(`IF($B$${rE}=0,0,COUNTIFS(${rng},">="&${L(0)}${r},${rng},"<"&${L(1)}${r}))`, cuentas[i]);
    }
    return { columna: g => columna(g, "'Simulación'!"), listaZ: `'Simulación'!${listaZ}`, colSens, previos, nombres, editado: `'Simulación'!$H$${rF}`, noPlano: `'Simulación'!$H$${rF + 1}`, valida: `'Simulación'!$H$${rF + 2}`, props, hist: { col: L, r0: rH + 1, r1: rH + nb, cH, cuentas, mx, mn } };
  }

  async function exportar(D, opts) {
    const ExcelJS = await libreria(), S = window.BIStats;
    const { desde, hasta, empresas, CAMPOS, avance = () => {}, percentil = 95 } = opts, Q = percentil / 100;
    const hi = D.historia, wb = new ExcelJS.Workbook(), { despeje } = S;
    wb.creator = "Barril Implícito — TIF Finanzas UADE"; wb.created = new Date();
    wb.calcProperties.fullCalcOnLoad = true;
    const emps = D.empresas.filter(e => empresas.includes(e.id) && hi.series[e.id] && hi.series[e.id].fecha.length)
      .map(e => { const p = S.preparar(D, e.id, desde, hasta); return p ? { ...p, info: e } : null; }).filter(Boolean);
    if (!emps.length || emps.some(e => e.n < S.MIN_RUEDAS)) throw new Error("no hay suficientes ruedas para ese rango y esas empresas");
    const co1 = Object.fromEntries(hi.brent_1l.fecha.map((f, i) => [f, hi.brent_1l.valor[i]]));
    const Di = {}, CALS = {};
    emps.forEach(e => {
      CALS[e.id] = e.cals;
      const s = hi.series[e.id], porP = Object.fromEntries(e.cals.map(k => [k.periodo, k._x]));
      Di[e.id] = {};
      s.fecha.forEach((f, i) => { if (f < desde || f > hasta) return; const p = s.periodos[s.cal_idx[i]]; if (porP[p]) Di[e.id][f] = { cap: s.cap_musd[i], bal: p, crp: s.crp[i], xl: S.despejeDia(porP[p], s.crp[i], s.cap_musd[i]), web: s.implicito[i], bd: S.bandaDia(porP[p], s.crp[i], s.cap_musd[i]), webMin: s.banda_min[i], webMax: s.banda_max[i] }; });
    });
    const fechas = [...new Set([...emps.flatMap(e => Object.keys(Di[e.id])), ...Object.keys(co1).filter(f => f >= desde && f <= hasta)])].sort();

    // --- test: especificación principal, referencia y sensibilidades (8.3)
    const CF = S.PRINCIPAL, { NSIM, NSENS, SEMILLA } = S;
    emps.forEach(e => { e.ev = S.evaluar(e, CF); });
    const grupos = S.grupos(emps, D), base = S.calibrar(emps), todos = emps.map(e => e.id);
    avance("Simulando la referencia sin reversión…");
    const corridas = await S.simular(emps, base, CF, NSIM, SEMILLA), bandas = [];
    for (const [k, z] of BANDAS.entries()) {
      avance(`Simulando la banda de ±${String(z).replace(".", ",")} desvíos…`);
      const cfg = { ...CF, z }, cas = emps.flatMap(e => S.evaluar(e, cfg).casos).filter(c => c.reg !== null);
      bandas.push({ z, nCasos: cas.length, obs: cas.filter(c => c.reg === 1).length / cas.length, corridas: z === CF.z ? corridas : await S.simular(emps, base, cfg, NSIM, SEMILLA + 100 + k) });
    }
    const sens = (await S.sensibilidades(emps, base, (i, n) => avance(`Sensibilidades (${i}/${n})…`))).map(x => ({ ...x, ref: S.media(x.sim), umbral: S.percentil(x.sim, Q) }));
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
     ["• Banda: banda de sensibilidad diaria de cada empresa (8.3), con los supuestos editables y si el CO1 queda fuera; las columnas de cálculo se abren con el botón + de arriba."],
     ["• Resumen: signo, magnitud y variabilidad de la prima (objetivo a)."],
     ["• Una hoja por empresa: insumos de cada balance y cálculo con fórmulas (editables)."],
     ["• Rango <empresa>: rango habitual, casos y regresos rueda a rueda, con fórmulas."],
     ["• Simulación: las corridas de la referencia sin reversión y su calibración. Control: Excel vs. web."],
     [""],
     ["Método (forma cerrada del motor)", { bold: true }],
     ["Producción plana Q hasta agotar las reservas probadas (máx. 30 años), flujos a mitad de año descontados al WACC → volumen descontado V."],
     ["Valor del patrimonio = A·P + B, con A = V·a·(1−t) y B = V·(m·(1−t) + t·DD&A − capex/boe) + no-upstream − deuda neta − minoritarios."],
     ["Integradas: no-upstream = EBITDA de 12 meses de esos segmentos × (1−t) × V/Q, con el WACC y el horizonte del upstream, sin múltiplo ni valor terminal (7.4). El bloque \"Valor no upstream\" de la hoja de cada integrada muestra los segmentos, el EBITDA editable, los trimestres que lo forman (si hay menos de 4 publicados, se anualiza su promedio), V/Q y el cociente contra la capitalización."],
     ["Banda de sensibilidad (8.3): recalcula el implícito de cada rueda con el WACC ±1 punto y con los costos (lifting y otros) ±10 %, uno por vez; la banda va del menor al mayor de los cuatro. Solo fuera de ella la prima se lee como información del mercado (7.1). Cubre los parámetros, no el sesgo de especificación. El WACC también mueve el valor no upstream; los costos solo tocan el upstream."],
     ["Riesgo país (7.4 y 8.2): entre balances varían la capitalización, el CO1 y el riesgo país. La hoja de cada empresa muestra el WACC con el riesgo país del día de publicación; cada rueda usa el suyo (columna Riesgo país de las hojas Rango, editable). Argentina: EMBI (ArgentinaDatos). Brasil: CDS a 5 años (Bloomberg). Norteamérica: 0."],
     ["Brent implícito P* = (capitalización − B) / A. Si P* < Pk (base imponible negativa), se usa el tramo sin impuesto: P* = (capitalización − B0) / A0."],
     ["a = participación del crudo × (1 − diferencial) × (1 − regalías − retenciones); m = margen por boe sin crudo (gas/NGL a precio fijo − lifting − otros costos)."],
     [""],
     ["CO1 (Brent, primer futuro ICE)", { bold: true }],
     [`Cierre diario del CO1 Comdty de Bloomberg hasta el ${hi.co1_bloomberg_hasta || "—"}; los días que faltan y lo posterior, Yahoo Finance BZ=F. No es el precio a la hora de cierre de cada acción que pide 6.1: sin historia intradiaria, el desfase se trata como ruido de cierre en la referencia (8.4).`],
     ["La prima usa el CO1 del mismo día; los días sin cotización de alguna de las dos quedan en blanco. Las hojas Rango incluyen hasta 20 ruedas antes y 15 después del rango elegido, para la ventana y la evaluación."],
     [""],
     ["Los insumos son editables: cambiar un valor en la hoja de una empresa recalcula su implícito, sus casos y los gráficos. La fecha de publicación decide qué balance rige cada día."],
     ["CO1 y capitalización del rango elegido se editan en Implícitos; las hojas Rango los toman de ahí. Las ruedas previas y posteriores al rango solo están en la hoja Rango de cada empresa."],
     ["La referencia simulada y el panel E se calculan al exportar. Si se editan datos o insumos no se recalculan, y la fila 11 de Consistencia lo avisa."],
    ].forEach(([t, f], i) => { const c = lm.getCell(`A${i + 1}`); c.value = t; if (f) c.font = f; c.alignment = { wrapText: true }; });

    wb.addWorksheet("Dashboard", { views: [{ showGridLines: false }] });
    wb.addWorksheet("Consistencia", { views: [{ state: "frozen", ySplit: 2 }] });

    // --- hojas por empresa
    const ultB = 4 + fechas.length, media = a => a.length ? S.media(a) : undefined;
    emps.forEach((e, j) => {
      const porBal = {};
      e.cals.forEach((k, ik) => { const ds = fechas.map(f => Di[e.id][f]).filter(d => d && d.bal === k.periodo), caps = e.cap.filter((_, t) => e.kIdx[t] === ik), conCo1 = fechas.filter(f => Di[e.id][f]?.bal === k.periodo && co1[f] != null).map(f => [Di[e.id][f].bd, co1[f]]);
        porBal[k.periodo] = { imp: media(ds.map(d => d.xl)), min: media(ds.map(d => d.bd.min)), max: media(ds.map(d => d.bd.max)), fuera: media(conCo1.map(([b, c]) => c >= b.min && c <= b.max ? 0 : 1)), cap: media(caps) }; });
      hojaEmpresa(wb, e.info, CALS[e.id], CAMPOS, { j, ult: ultB, n: e.n, porBal });
    });

    // --- Implícitos
    const im = wb.addWorksheet("Implícitos", { views: [{ state: "frozen", xSplit: 2, ySplit: 4 }] });
    im.getCell("A1").value = "Brent implícito diario por empresa y CO1"; im.getCell("A1").font = { bold: true, size: 13 };
    im.getCell("A2").value = "Implícito = fórmula de la hoja Rango de cada empresa (balance vigente y riesgo país de ese día). Prima = implícito − CO1, en USD/bbl.";
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
        const c0 = ubic[e.id], d = Di[e.id][f], cI = col(c0 + 1);
        if (!d) return;
        const t = e.fechas.indexOf(f), rR = 5 + t;   // fila de esa fecha en la hoja Rango; sin CO1 ese día no hay rueda y queda el valor calculado
        fila.getCell(c0).value = d.cap; fila.getCell(c0).numFmt = "#,##0";
        fila.getCell(c0 + 1).value = fx(balanceVigente(e.id, CALS[e.id].length)(`$A${r}`), d.bal);
        fila.getCell(c0 + 2).value = t >= 0 ? fx(`'Rango ${e.id}'!$F$${rR}+'Rango ${e.id}'!$B$${rR}`, d.xl) : d.xl;
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

    // --- Banda de sensibilidad (8.3)
    const bs = wb.addWorksheet("Banda", { views: [{ state: "frozen", xSplit: 2, ySplit: 4 }], properties: { outlineLevelCol: 1 } });
    bs.getCell("A1").value = "Banda de sensibilidad del Brent implícito (8.3 y 7.1): la prima solo se lee como información del mercado si el CO1 queda fuera de la banda"; bs.getCell("A1").font = { bold: true, size: 13 };
    bs.getCell("A2").value = "WACC ±"; bs.getCell("B2").value = S.BANDA.wacc; bs.getCell("B2").numFmt = "0.00%"; bs.getCell("C2").value = "Costos ±"; bs.getCell("D2").value = S.BANDA.costos; bs.getCell("D2").numFmt = "0%";
    ["A2", "C2"].forEach(c => bs.getCell(c).font = { bold: true }); ["B2", "D2"].forEach(c => bs.getCell(c).fill = SUB.fill);
    bs.getCell("E2").value = "Supuestos preliminares de 8.3: se pueden editar. Cada rueda usa el balance vigente y su riesgo país; se varía un supuesto por vez."; Object.assign(bs.getCell("E2"), GRIS);
    bs.getCell("A3").value = "Fuera = 1: el CO1 queda fuera de la banda. Las columnas de cálculo de cada empresa (n.º de balance, WACC del día, ρ = V del escenario / V del balance y los cuatro escenarios) están agrupadas."; Object.assign(bs.getCell("A3"), GRIS);
    const cabB = ["Fecha", "CO1 (USD/bbl)"];
    emps.forEach(e => cabB.push(`${e.id} implícito`, `${e.id} banda mín.`, `${e.id} banda máx.`, `${e.id} prima mín.`, `${e.id} prima máx.`, `${e.id} fuera`, `${e.id} n.º bal.`, `${e.id} WACC día`, `${e.id} ρ base`, `${e.id} ρ WACC −`, `${e.id} ρ WACC +`, `${e.id} WACC −`, `${e.id} WACC +`, `${e.id} costos −`, `${e.id} costos +`));
    bs.getRow(4).values = cabB; bs.getRow(4).eachCell(c => Object.assign(c, HEAD)); bs.getRow(4).alignment = { wrapText: true, vertical: "middle" }; bs.getRow(4).height = 46;
    bs.getColumn(1).width = 11; bs.getColumn(2).width = 10;
    emps.forEach((e, j) => { for (let d = 0; d < BK; d++) { const c = bs.getColumn(3 + BK * j + d); c.width = 9.5; if (d >= 6) { c.outlineLevel = 1; c.hidden = true; } } });
    fechas.forEach((f, i) => {
      const r = 5 + i, fila = bs.getRow(r), hayCo1 = co1[f] != null;
      fila.getCell(1).value = fechaXL(f); fila.getCell(1).numFmt = "dd/mm/yyyy";
      if (hayCo1) { fila.getCell(2).value = fx(`'Implícitos'!$B$${r}`, co1[f]); fila.getCell(2).numFmt = "0.00"; }
      emps.forEach((e, j) => {
        const d = Di[e.id][f]; if (!d) return;
        const c0 = 3 + BK * j, L = k => `$${colB(j, k)}${r}`, id = e.id, t = e.fechas.indexOf(f), cal = e.cals.find(k => k.periodo === d.bal), x = cal._x, k0 = cal._k;
        const ix = q => `INDEX('${id}'!$C$${q}:$Z$${q},${L(6)})`, capI = `'Implícitos'!$${col(ubic[id] - 1)}$${r}`, crpD = t >= 0 ? `'Rango ${id}'!$Y$${5 + t}` : d.crp;
        const deuda = `(${ix(R_.deuda_neta_musd)}+${ix(R_.minoritarios_musd)})`;
        const rho = w => `(${ix(C.q)}*(1+${w})^0.5*(1-(1+${w})^(-${ix(C.n)}))/${w}+${ix(C.rem)}*(1+${w})^(-(${ix(C.n)}+0.5)))/${ix(C.v)}`;
        const esc_ = (rh, fB, fB0, fPk) => { const p1 = `(${capI}+${deuda}-(${ix(fB)}+${deuda})*${rh})/(${ix(C.A)}*${rh})`, p0 = `(${capI}+${deuda}-(${ix(fB0)}+${deuda})*${rh})/(${ix(C.A0)}*${rh})`; return `IF(${p1}<${ix(fPk)},${p0},${p1})`; };
        const V_ = y => S.coef({ ...y, crp: d.crp }).V / k0.V;
        fila.getCell(c0 + 6).value = fx(`MATCH('Implícitos'!$${col(ubic[id])}$${r},'${id}'!$C$4:$Z$4,0)`, e.cals.indexOf(cal) + 1);
        fila.getCell(c0 + 7).value = fx(`${ix(C.wacc)}+(1-${ix(R_.peso_deuda)})*${ix(R_.lambda_crp)}*(${crpD}-${ix(R_.crp)})`, S.coef({ ...x, crp: d.crp }).r); fila.getCell(c0 + 7).numFmt = "0.00%";
        fila.getCell(c0 + 8).value = fx(rho(L(7)), V_(x));
        fila.getCell(c0 + 9).value = fx(rho(`(${L(7)}-${PBANDA.w})`), V_(S.conWacc(x, -S.BANDA.wacc)));
        fila.getCell(c0 + 10).value = fx(rho(`(${L(7)}+${PBANDA.w})`), V_(S.conWacc(x, S.BANDA.wacc)));
        [8, 9, 10].forEach(k => fila.getCell(c0 + k).numFmt = "0.0000");
        [esc_(L(9), C.B, C.B0, C.pk), esc_(L(10), C.B, C.B0, C.pk), esc_(L(8), CB.bM, CB.b0M, CB.pM), esc_(L(8), CB.bP, CB.b0P, CB.pP)].forEach((fm, k) => { fila.getCell(c0 + 11 + k).value = fx(fm, d.bd.v[k]); fila.getCell(c0 + 11 + k).numFmt = "0.00"; });
        const esc4 = `${L(11)}:${L(14)}`;
        fila.getCell(c0).value = fx(`'Implícitos'!$${col(ubic[id] + 1)}$${r}`, d.xl);
        fila.getCell(c0 + 1).value = fx(`MIN(${esc4})`, d.bd.min); fila.getCell(c0 + 2).value = fx(`MAX(${esc4})`, d.bd.max);
        if (hayCo1) {
          fila.getCell(c0 + 3).value = fx(`${L(1)}-$B${r}`, d.bd.min - co1[f]); fila.getCell(c0 + 4).value = fx(`${L(2)}-$B${r}`, d.bd.max - co1[f]);
          fila.getCell(c0 + 5).value = fx(`IF(AND($B${r}>=${L(1)},$B${r}<=${L(2)}),0,1)`, co1[f] >= d.bd.min && co1[f] <= d.bd.max ? 0 : 1);
        }
        [0, 1, 2, 3, 4].forEach(k => fila.getCell(c0 + k).numFmt = "0.00");
      });
    });

    // --- Control
    const ct = wb.addWorksheet("Control", { views: [{ state: "frozen", xSplit: 1, ySplit: 4 }] });
    ct.getCell("A1").value = "Control: implícito de este Excel vs. implícito de la web (motor por bisección, tolerancia 0,005, más el redondeo de la web a 2 decimales)"; ct.getCell("A1").font = { bold: true };
    const cB0 = 2 + 2 * emps.length;   // a la derecha, la banda: mayor diferencia entre los extremos del Excel y los de la web
    ct.getRow(4).values = ["Fecha", ...emps.flatMap(e => [`${e.id} web`, `${e.id} Excel − web`]), ...emps.flatMap(e => [`${e.id} banda mín. web`, `${e.id} banda máx. web`, `${e.id} banda: máx. |Excel − web|`])];
    ct.getRow(4).eachCell(c => Object.assign(c, HEAD)); ct.getColumn(1).width = 11;
    fechas.forEach((f, i) => {
      const r = 5 + i, fila = ct.getRow(r); fila.getCell(1).value = fechaXL(f); fila.getCell(1).numFmt = "dd/mm/yyyy";
      emps.forEach((e, j) => { const d = Di[e.id][f]; if (!d || d.web == null) return;
        const cw = 2 + 2 * j, ci = col(ubic[e.id] + 1), cwL = col(cw - 1);
        fila.getCell(cw).value = d.web; fila.getCell(cw).numFmt = "0.00";
        fila.getCell(cw + 1).value = fx(`'Implícitos'!${ci}${r}-${cwL}${r}`, d.xl - d.web); fila.getCell(cw + 1).numFmt = "0.000"; });
      emps.forEach((e, j) => { const d = Di[e.id][f]; if (!d || d.webMin == null || d.webMax == null) return;
        const cw = cB0 + 3 * j, lMin = col(cw - 1), lMax = col(cw);
        fila.getCell(cw).value = d.webMin; fila.getCell(cw + 1).value = d.webMax; fila.getCell(cw).numFmt = fila.getCell(cw + 1).numFmt = "0.00";
        fila.getCell(cw + 2).value = fx(`MAX(ABS(Banda!$${colB(j, 1)}$${r}-${lMin}${r}),ABS(Banda!$${colB(j, 2)}$${r}-${lMax}${r}))`, Math.max(Math.abs(d.bd.min - d.webMin), Math.abs(d.bd.max - d.webMax))); fila.getCell(cw + 2).numFmt = "0.000"; });
    });

    // --- Resumen (objetivo a)
    const rs = wb.addWorksheet("Resumen");
    rs.getCell("A1").value = `Prima = implícito − CO1 (USD/bbl), del ${desde} al ${hasta}`; rs.getCell("A1").font = { bold: true, size: 13 };
    const primas = Object.fromEntries(emps.map(e => [e.id, fechas.filter(f => Di[e.id][f] && co1[f] != null).map(f => Di[e.id][f].xl - co1[f])]));
    const impls = Object.fromEntries(emps.map(e => [e.id, Object.values(Di[e.id]).map(d => d.xl)]));
    const abs = a => S.media(a.map(Math.abs)), { sd } = S;
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
        if (q === "n") cell.value = fx(`COUNTA('${e.id}'!$C$4:$Z$4)`, CALS[e.id].length);
        else if (q === "c") { const cd = col(2 + 2 * j), a = Object.values(Di[e.id]).filter(d => d.web != null).map(d => Math.abs(d.xl - d.web)); cell.value = fx(`MAX(MAX(Control!${cd}5:${cd}${ult}),-MIN(Control!${cd}5:${cd}${ult}))`, Math.max(...a)); }
        else cell.value = fx(f_(`'Implícitos'!${ci}5:${ci}${ult}`), js(q === "i" ? impls[e.id] : primas[e.id]));
      });
    });

    // banda de sensibilidad (8.3), en el mismo cuadro
    const rB0_ = 5 + met.length;
    rs.getCell(rB0_, 1).value = "Banda de sensibilidad (8.3): hoja Banda"; Object.assign(rs.getCell(rB0_, 1), SUB);
    const rgB = (j, d) => `Banda!$${colB(j, d)}$5:$${colB(j, d)}$${ult}`, datB = e => fechas.map(f => Di[e.id][f]).filter(Boolean), conCo = e => fechas.filter(f => Di[e.id][f] && co1[f] != null).map(f => ({ b: Di[e.id][f].bd, c: co1[f] }));
    [["Ancho medio de la banda", "0.00", j => `AVERAGE(${rgB(j, 2)})-AVERAGE(${rgB(j, 1)})`, e => S.media(datB(e).map(d => d.bd.max - d.bd.min))],
     ["Prima con el extremo inferior (media)", "0.00", j => `AVERAGE(${rgB(j, 3)})`, e => S.media(conCo(e).map(x => x.b.min - x.c))],
     ["Prima con el extremo superior (media)", "0.00", j => `AVERAGE(${rgB(j, 4)})`, e => S.media(conCo(e).map(x => x.b.max - x.c))],
     ["% de ruedas con el CO1 fuera de la banda", "0%", j => `AVERAGE(${rgB(j, 5)})`, e => S.media(conCo(e).map(x => x.c >= x.b.min && x.c <= x.b.max ? 0 : 1))],
     ["Control banda: máx. |Excel − web|", "0.000", j => { const l = col(cB0 + 3 * j + 1); return `MAX(Control!$${l}$5:$${l}$${ult})`; }, e => Math.max(...datB(e).filter(d => d.webMin != null && d.webMax != null).map(d => Math.max(Math.abs(d.bd.min - d.webMin), Math.abs(d.bd.max - d.webMax))))]]
      .forEach(([lab, nf, fm, js], i) => { const fila = rs.getRow(rB0_ + 1 + i); fila.getCell(1).value = lab; filaRs[lab] = rB0_ + 1 + i;
        emps.forEach((e, j) => { const cell = fila.getCell(2 + j); cell.value = fx(fm(j), js(e)); cell.numFmt = nf; }); });

    // --- Rango por empresa y Simulación
    const RG = {};
    const filaIm = Object.fromEntries(fechas.map((f, i) => [f, 5 + i]));
    emps.forEach(e => { RG[e.id] = hojaRango(wb, e, e.ev, CF, { fila: filaIm, cap: col(ubic[e.id] - 1), tiene: f => !!Di[e.id][f] }); });
    const obsCas = emps.flatMap(e => e.ev.casos);
    const rA = 12, SIM = hojaSimulacion(wb, emps, grupos, bandas, base, NSIM, SEMILLA, sens, RG, rA + 1 + grupos.length, CF), props = SIM.props;

    // --- Consistencia
    const cs = wb.getWorksheet("Consistencia");
    cs.getColumn(1).width = 50; for (let c = 2; c <= 15; c++) cs.getColumn(c).width = 12.5;
    cs.getCell("A1").value = "Consistencia de la prima: ¿los desvíos amplios son transitorios?"; cs.getCell("A1").font = { bold: true, size: 14 };
    cs.getCell("A2").value = `Rango ${desde} a ${hasta} · ${emps.map(e => e.id).join(", ")}`; Object.assign(cs.getCell("A2"), GRIS);
    cs.getCell("A3").value = "Hipótesis (6): la proporción de desvíos amplios que regresa a su rango habitual en el corto plazo supera el umbral de una referencia simulada sin reversión. Es una comparación descriptiva con una referencia, no una prueba de significación (7.7).";
    cs.mergeCells("A3:O3"); cs.getCell("A3").alignment = { wrapText: true, vertical: "top" }; cs.getRow(3).height = 32;
    const titPanel = (r, t) => { const c = cs.getCell(`A${r}`); c.value = t; cs.mergeCells(`A${r}:O${r}`); Object.assign(c, SUB); };
    titPanel(5, "Especificación (6.1). Banda y percentil recalculan el panel A, umbral incluido. Plazo y recorrido no tienen referencia simulada: el panel A deja de dar veredicto y hay que leer el panel E. La fila 11 avisa si algo no es comparable");
    [["Ventana del rango habitual (ruedas previas)", S.VENTANA, "Fija, no se edita: 20 ruedas ≈ un mes bursátil"], ["Banda: desvíos estándar", CF.z, "Principal: 2. Elegir de la lista: cada valor tiene su referencia simulada"], ["Plazo de regreso (ruedas, máx. 15)", CF.plazo, "Principal: 10. Sensibilidad: 5 y 15"],
     ["Recorrido mínimo hacia la media (× d0)", CF.rec, "Principal: ½. Sensibilidad: ⅓ y ⅔"], ["Percentil de la referencia usado como umbral", percentil, "Elegido en la página; la tesis no fija el percentil"]]
      .forEach(([l, v, n], i) => { const r = 6 + i; cs.getCell(`A${r}`).value = l; const c = cs.getCell(`C${r}`); c.value = v; c.font = i ? { bold: true, color: { argb: "FF0000C0" } } : { bold: true }; if (i) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF8DC" } }; cs.getCell(`D${r}`).value = n; Object.assign(cs.getCell(`D${r}`), GRIS); });
    cs.getCell("C8").dataValidation = { type: "whole", operator: "between", formulae: [1, 15], showErrorMessage: true, error: "Entre 1 y 15 ruedas" };
    cs.getCell("C7").dataValidation = { type: "list", allowBlank: false, formulae: [SIM.listaZ], showErrorMessage: true, error: "Elegí una banda de la lista: son las que tienen referencia simulada" };
    cs.getCell("C9").dataValidation = { type: "decimal", operator: "between", formulae: [0, 1], showErrorMessage: true, error: "Entre 0 y 1: es la fracción de d0 que debe recorrer" };
    cs.getCell("C10").dataValidation = { type: "decimal", operator: "between", formulae: [0, 100], showErrorMessage: true, error: "Entre 0 y 100" };
    // La referencia se simula al exportar: sin corridas para esa especificación, comparar con otra daría un veredicto falso
    const rTot = rA + 1 + grupos.length, nc = fm => `IF(${SIM.valida}=0,"n/c",${fm})`;
    cs.mergeCells("A11:O11"); cs.getCell("A11").font = { bold: true, color: { argb: "FFC00000" } };
    cs.getCell("A11").value = fx(`IF(ISERROR($B$${rTot}),"Atención: hay errores en los casos (por ejemplo, una fecha de publicación movida más allá de lo calculado). El panel A no da veredicto: revisá las hojas de empresa y Rango.",IF(${SIM.valida}=0,"Atención: la referencia simulada existe para las bandas de la lista, con ${CF.plazo} ruedas y ½ d0. Con otra especificación el panel A no da veredicto (n/c): usar el panel E, que la recalcula.",IF(${SIM.noPlano}>0,"Atención: hay balances con perfil de producción no plano. La forma cerrada de este Excel no los contempla: el implícito sale como si fuera plano.",IF(${SIM.editado}=1,"Atención: se editaron insumos o datos de mercado. Casos y regresos se actualizan, pero la referencia simulada y el panel E quedan como al exportar: el umbral es aproximado.",""))))`, "");

    // Panel A: objetivo c) y prueba de la hipótesis
    titPanel(rA, "A. Regreso de los desvíos amplios frente a la referencia simulada (objetivo c y hipótesis)");
    cs.getRow(rA + 1).values = ["Grupo", "Casos", "Regresos", "No regresan", "Censurados", "Proporción de regreso", "Referencia media", "Umbral (percentil)", "Exceso sobre umbral", "¿Supera el umbral?", "Posición en la referencia", "Ruedas medias hasta regreso", "|d0| medio (USD/bbl)", "Casos que cruzan balance", "Proporción sin cruzar balance"];
    cs.getRow(rA + 1).eachCell(c => Object.assign(c, HEAD)); cs.getRow(rA + 1).alignment = { wrapText: true, vertical: "middle", horizontal: "center" }; cs.getRow(rA + 1).height = 45;
    const filaG = {}; grupos.forEach((g, i) => { filaG[g.nombre] = rA + 2 + i; });
    const obsDe = ids => S.observado(emps, ids);
    const R = (id, c_) => `'Rango ${id}'!$${c_}$${RG[id].f0}:$${c_}$${RG[id].f0 + RG[id].n - 1}`;
    grupos.forEach((g, i) => {
      const r = filaG[g.nombre], f = cs.getRow(r), o = obsDe(g.ids), simC = SIM.columna(i), a = props[i].filter(v => v != null);
      const um = S.percentil(a, Q), suma = c => g.ids.map(id => `${c}${filaG[id]}`).join("+");
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
      f.getCell(6).value = fx(`IF(ISERROR(B${r}),"n/c",IF(C${r}+D${r}>0,C${r}/(C${r}+D${r}),""))`, o.prop ?? "");
      f.getCell(7).value = fx(nc(`AVERAGE(${simC})`), S.media(a)); f.getCell(8).value = fx(nc(`PERCENTILE(${simC},$C$10/100)`), um);
      f.getCell(9).value = fx(nc(`IF(F${r}="","",F${r}-H${r})`), o.prop == null ? "" : o.prop - um);
      f.getCell(10).value = fx(nc(`IF(F${r}="","",IF(F${r}>H${r},"Sí","No"))`), o.prop == null ? "" : (o.prop > um ? "Sí" : "No")); f.getCell(10).alignment = { horizontal: "center" };
      f.getCell(11).value = fx(nc(`IF(F${r}="","",COUNTIF(${simC},"<="&F${r})/COUNT(${simC}))`), o.prop == null ? "" : a.filter(v => v <= o.prop).length / a.length);
      [6, 7, 8, 11, 15].forEach(c => f.getCell(c).numFmt = "0.0%"); f.getCell(9).numFmt = "+0.0%;-0.0%"; f.getCell(12).numFmt = "0.0"; f.getCell(13).numFmt = "0.00";
      if (g.tipo === "total") f.eachCell(c => { c.font = { bold: true }; c.fill = SUB.fill; });
    });
    const oT = obsDe(todos), aT = props[grupos.length - 1].filter(v => v != null), umT = S.percentil(aT, Q);
    let r = rTot + 1;
    const dec = v => String(Math.round(v * 1000) / 10).replace(".", ","), lectura = (p, u) => `Lectura: la proporción de regreso (${dec(p)}%) ${p > u ? "supera" : "no supera"} el umbral (${dec(u)}%): la hipótesis ${p > u ? "se sostiene" : "no se sostiene"} con esta especificación.`;
    cs.getCell(`A${r}`).value = fx(`IF(${SIM.valida}=0,IF(ISNUMBER(F${rTot}),"Lectura: proporción de regreso de "&ROUND(F${rTot}*100,1)&"% con esta especificación; sin veredicto, ver panel E.","Lectura: sin veredicto, hay errores en los casos."),"Lectura: la proporción de regreso ("&ROUND(F${rTot}*100,1)&"%) "&IF(F${rTot}>H${rTot},"supera","no supera")&" el umbral ("&ROUND(H${rTot}*100,1)&"%): la hipótesis "&IF(F${rTot}>H${rTot},"se sostiene","no se sostiene")&" con esta especificación.")`, lectura(oT.prop, umT));
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
    const { corr } = S;
    emps.forEach(e => { const f = cs.getRow(r); f.getCell(1).value = e.id; emps.forEach((o, j) => { const [x, y] = serieCom(e.id, o.id); f.getCell(2 + j).value = fx(`CORREL(${rIm(col(ubic[e.id] + 2))},${rIm(col(ubic[o.id] + 2))})`, corr(x, y)); f.getCell(2 + j).numFmt = "0.00"; }); r++; });
    r++;
    if (PARES.length) {
      cs.getRow(r).values = ["Par (misma región; perfil puro − integrada)", "Diferencia media", "|Diferencia| media", "Desvío", "Mínima", "Máxima", "% días perfil puro > integrada"]; cs.getRow(r).eachCell(c => Object.assign(c, HEAD)); cs.getRow(r).alignment = { wrapText: true, vertical: "middle" }; cs.getRow(r).height = 48; r++;
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
    const din = emps.map(S.dinamica);
    const filasD = [[fx(`"% de ruedas fuera del rango (≈"&ROUND(200*(1-NORMSDIST($C$7)),1)&" % si la prima fuera normal)"`, "% de ruedas fuera del rango (≈4,6 % si la prima fuera normal)"), e => `SUM('Rango ${e.id}'!$K$${RG[e.id].r0}:$K$${RG[e.id].r1})/COUNT('Rango ${e.id}'!$K$${RG[e.id].r0}:$K$${RG[e.id].r1})`, d => d.fue, "0.0%"],
      ["Coeficiente AR(1) de la prima (ρ)", e => `1+SLOPE(${R(e.id, "T")},${R(e.id, "U")})`, d => d.rho, "0.000"],
      ["Vida media del desvío (ruedas) = ln(0,5)/ln(ρ)", (e, q, rr) => `IF(AND(${q}${rr - 1}>0,${q}${rr - 1}<1),LN(0.5)/LN(${q}${rr - 1}),"sin reversión")`, d => d.vida ?? "sin reversión", "0.0"],
      ["Estadístico t de (ρ−1), tipo Dickey-Fuller (referencia 5 %: −2,86)", e => `SLOPE(${R(e.id, "T")},${R(e.id, "U")})/(STEYX(${R(e.id, "T")},${R(e.id, "U")})/SQRT(DEVSQ(${R(e.id, "U")})))`, d => d.t, "0.00"],
      ["Autocorrelación de los cambios diarios de la prima", e => `CORREL(${R(e.id, "T")},${R(e.id, "V")})`, d => d.ac, "0.000"],
      ["Ruido de cierre implícito (USD/bbl) = √máx(0, −cov)", e => `SQRT(MAX(0,-COVAR(${R(e.id, "T")},${R(e.id, "V")})))`, d => d.ruido, "0.000"],
      ["Desvío de los cambios diarios (USD/bbl)", e => `STDEV(${R(e.id, "T")})`, d => d.sdd, "0.00"], ["Asimetría de los cambios diarios", e => `SKEW(${R(e.id, "T")})`, d => d.skew, "0.00"], ["Curtosis en exceso de los cambios diarios", e => `KURT(${R(e.id, "T")})`, d => d.kurt, "0.00"]];
    filasD.forEach(([lab, fm, js, nf]) => { const f = cs.getRow(r); f.getCell(1).value = lab; emps.forEach((e, j) => { f.getCell(2 + j).value = fx(fm(e, col(1 + j), r), js(din[j])); f.getCell(2 + j).numFmt = nf; }); r++; });
    cs.getCell(`A${r}`).value = "Un ρ menor que 1 con vida media de días es compatible con desvíos transitorios; una vida media larga, con una prima persistente. La regla del panel A es la que define la hipótesis."; Object.assign(cs.getCell(`A${r}`), GRIS); r += 2;

    // Panel E: sensibilidades de 8.3
    titPanel(r, "E. Sensibilidades (8.3 y 8.4), con la referencia recalculada en cada fila. Casos y corridas se calculan al exportar; el umbral sigue al percentil"); r++;
    cs.getRow(r).values = ["Escenario", "Casos", "Regresos", "Censurados", "Proporción", "Referencia media", fx(`"Umbral P"&$C$10`, `Umbral P${String(percentil).replace(".", ",")}`), "Exceso", "¿Supera?"]; cs.getRow(r).eachCell(c => Object.assign(c, HEAD)); cs.getRow(r).alignment = { wrapText: true, vertical: "middle" }; cs.getRow(r).height = 32; r++;
    const filaS = (nom, cas, reg, cen, prop, x, iS) => { const f = cs.getRow(r), c = SIM.colSens(iS);
      f.values = [nom, cas, reg, cen, prop, fx(`AVERAGE(${c})`, x.ref), fx(`PERCENTILE(${c},$C$10/100)`, x.umbral), fx(`E${r}-G${r}`, prop - x.umbral), fx(`IF(E${r}>G${r},"Sí","No")`, prop > x.umbral ? "Sí" : "No")];
      [5, 6, 7].forEach(k => f.getCell(k).numFmt = "0.0%"); f.getCell(8).numFmt = "+0.0%;-0.0%"; f.getCell(9).alignment = { horizontal: "center" }; r++; };
    sens.forEach((s, i) => filaS(s.nombre, s.cas, s.reg, s.cen, s.prop, s, i));
    { const c = obsCas.filter(x => !x.cruza && x.reg !== null), reg = c.filter(x => x.reg === 1).length; filaS("Solo casos que no cruzan un balance (referencia principal)", c.length, reg, 0, reg / c.length, sens[0], 0); }
    cs.getCell(`A${r}`).value = `Corridas: ${NSENS} por escenario (${NSIM} en el panel A), por eso la principal puede diferir unas décimas. El control contra el CO12 de 8.4 no se calcula: no hay historia del CO12 en la web.`; Object.assign(cs.getCell(`A${r}`), GRIS); r += 2;

    // Panel F: lista de casos; cada fila busca el n-ésimo caso, así sigue a banda, plazo y recorrido
    titPanel(r, "F. Casos con la especificación elegida (siguen a banda, plazo y recorrido; los valores leen las hojas Rango)"); r++;
    const capF = Math.max(...bandas.map(b => b.nCasos)) + 30;
    cs.getCell(`A${r}`).value = fx(`IF(N($B$${rTot})>${capF},"Hay más casos que las ${capF} filas de esta lista: el resto se ve en las hojas Rango.","")`, ""); cs.getCell(`A${r}`).font = { bold: true, color: { argb: "FFC00000" } }; r++;
    cs.getRow(r).values = ["Empresa", "Fecha del desvío", "Balance", "Prima", "Media 20", "d0", "Regresó", "Ruedas hasta regreso", "Cruza balance"]; cs.getRow(r).eachCell(c => Object.assign(c, HEAD)); cs.getRow(r).alignment = { wrapText: true, vertical: "middle" }; r++;
    [17, 18, 19].forEach(c => { cs.getColumn(c).hidden = true; });   // auxiliares: empresa, n.º de caso dentro de ella y fila en su hoja Rango
    const elige = (c_, q) => `CHOOSE($Q${q},${emps.map(e => R(e.id, c_)).join(",")})`, casosF = emps.flatMap(e => e.ev.casos.map(c => ({ e, c })));
    for (let j = 1; j <= capF; j++, r++) {
      const f = cs.getRow(r), x = casosF[j - 1], lee = c_ => `IF($S${r}="","",INDEX(${elige(c_, r)},$S${r}))`;
      f.getCell(17).value = fx(`IFERROR(IF(${j}>$B$${rTot},"",MATCH(${j - 1},${SIM.previos},1)),"")`, x ? emps.indexOf(x.e) + 1 : "");
      f.getCell(18).value = fx(`IF($Q${r}="","",${j}-INDEX(${SIM.previos},$Q${r}))`, x ? x.e.ev.casos.indexOf(x.c) + 1 : "");
      f.getCell(19).value = fx(`IF($Q${r}="","",IFERROR(MATCH($R${r},${elige("X", r)},0),""))`, x ? x.c.t + 1 : "");
      const m = x ? S.rangoK(x.e, x.c.k).m[x.c.t] : null;
      f.getCell(1).value = fx(`IF($S${r}="","",INDEX(${SIM.nombres},$Q${r}))`, x ? x.e.id : "");
      f.getCell(2).value = fx(lee("A"), x ? fechaXL(x.e.fechas[x.c.t]) : ""); f.getCell(2).numFmt = "dd/mm/yyyy";
      f.getCell(3).value = fx(lee("D"), x ? x.e.bal[x.c.t] : "");
      f.getCell(4).value = fx(lee("F"), x ? m + x.c.d0 : ""); f.getCell(5).value = fx(lee("G"), x ? m : ""); f.getCell(6).value = fx(lee("M"), x ? x.c.d0 : ""); [4, 5, 6].forEach(k => f.getCell(k).numFmt = "0.00");
      f.getCell(7).value = fx(lee("Q"), x ? (x.c.reg === null ? "censurado" : x.c.reg) : ""); f.getCell(8).value = fx(lee("R"), x ? x.c.h ?? "" : ""); f.getCell(9).value = fx(lee("S"), x ? x.c.cruza : "");
    }

    // --- observada en el histograma
    const sh = wb.getWorksheet("Simulación"), H_ = SIM.hist;
    for (let q = H_.r0; q <= H_.r1; q++) { const a = sh.getCell(q, H_.cH).value, b = sh.getCell(q, H_.cH + 1).value;
      sh.getCell(q, H_.cH + 4).value = fx(`IF(AND(${SIM.valida}=1,Consistencia!$F$${rTot}>=${H_.col(0)}${q},Consistencia!$F$${rTot}<${H_.col(1)}${q}),MAX(${H_.col(3)}$${H_.r0}:${H_.col(3)}$${H_.r1}),0)`, oT.prop >= a && oT.prop < b ? H_.mx : 0); }

    // --- Dashboard
    const ds = wb.getWorksheet("Dashboard");
    for (let c = 1; c <= 24; c++) ds.getColumn(c).width = 8.5;
    ds.getCell("A1").value = "Brent implícito y prima: dashboard"; ds.getCell("A1").font = { bold: true, size: 16 };
    ds.getCell("A2").value = `Rango ${desde} a ${hasta} · ${emps.map(e => e.id).join(", ")} · Los gráficos e indicadores leen las celdas de las demás hojas`; Object.assign(ds.getCell("A2"), GRIS);
    const KPI = [["Desvíos amplios (casos)", `Consistencia!B${rTot}`, oT.n, "0"], ["Regresan en el plazo", `Consistencia!C${rTot}`, oT.reg, "0"], ["Proporción de regreso", `Consistencia!F${rTot}`, oT.prop, "0.0%"],
      ["Referencia simulada (media)", `Consistencia!G${rTot}`, S.media(aT), "0.0%"], ["Umbral (percentil de la referencia)", `Consistencia!H${rTot}`, umT, "0.0%"], ["¿Supera el umbral?", `Consistencia!J${rTot}`, oT.prop > umT ? "Sí" : "No", "General"]];
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

    const fgB = fg + Math.ceil(emps.length / 3) * 16, catB = `Banda!$A$5:$A$${ult}`, serB = (l, color, extra) => ({ nombreRef: `Banda!$${l}$4`, cat: catB, val: `Banda!$${l}$5:$${l}$${ult}`, color, ...extra });
    emps.forEach((e, j) => { const cC = (j % 3) * 8, fC = fgB + Math.floor(j / 3) * 16;
      poner({ titulo: `${e.id}: implícito, banda de sensibilidad y CO1 (USD/bbl)`, tipo: "line", fmtY: "0", mesesEje: 6, series: [serB(colB(j, 0), COLORES[e.id]), serB(colB(j, 1), "999999", { ancho: 9525, guion: "dash" }), serB(colB(j, 2), "999999", { ancho: 9525, guion: "dash" }), serB("B", "111111", { ancho: 19050 })] }, cC, fC, cC + 8, fC + 15); });

    const orden = ["Leeme", "Dashboard", "Consistencia", "Implícitos", "Banda", "Resumen", ...emps.map(e => e.id), ...emps.map(e => "Rango " + e.id), "Simulación", "Control"];
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
