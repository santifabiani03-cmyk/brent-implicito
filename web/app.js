(function () {
  const M = window.MotorBrent;
  const CAMPOS = {
    prod_crudo_kbd: ["Producción de crudo", "kbbl/d"], prod_otros_kboed: ["Producción gas + NGL", "kboe/d"],
    precio_otros_usd_boe: ["Precio gas + NGL (fijo)", "USD/boe"], diferencial_pct: ["Diferencial de realización vs Brent", "%"],
    regalias_pct: ["Regalías", "%"], retencion_pct: ["Derechos de exportación", "%"], lifting_usd_boe: ["Lifting cost", "USD/boe"],
    otros_costos_usd_boe: ["Otros costos (G&A, transporte)", "USD/boe"], capex_musd_anual: ["Capex anual", "MUSD"],
    dda_usd_boe: ["Amortización fiscal", "USD/boe"], tasa_impuesto: ["Tasa de impuesto", "%"],
    reservas_1p_mmboe: ["Reservas probadas (1P)", "MMboe"], crecimiento_anual: ["Crecimiento de producción", "%/año"],
    anios_crecimiento: ["Años de crecimiento", "años"], declino_anual: ["Declino posterior", "%/año"],
    deuda_neta_musd: ["Deuda neta", "MUSD"], minoritarios_musd: ["Intereses minoritarios", "MUSD"],
    valor_no_upstream_musd: ["Valor segmentos no-upstream", "MUSD"], rf: ["Tasa libre de riesgo", "%"], beta: ["Beta", "—"],
    erp: ["Prima de mercado", "%"], crp: ["Prima riesgo país", "%"], lambda_crp: ["Exposición al riesgo país (λ)", "—"],
    kd: ["Costo de la deuda", "%"], peso_deuda: ["Peso de la deuda D/V", "%"]
  };
  const PCT = new Set(Object.entries(CAMPOS).filter(([, v]) => v[1].startsWith("%")).map(([k]) => k));
  const SINT = { prod_crudo_kbd: 100, prod_otros_kboed: 20, precio_otros_usd_boe: 20, diferencial_pct: 0.1, regalias_pct: 0.12,
    retencion_pct: 0, lifting_usd_boe: 10, otros_costos_usd_boe: 5, capex_musd_anual: 800, dda_usd_boe: 12, tasa_impuesto: 0.3,
    reservas_1p_mmboe: 400, crecimiento_anual: 0.05, anios_crecimiento: 3, declino_anual: 0.1, deuda_neta_musd: 1000,
    minoritarios_musd: 0, valor_no_upstream_musd: 0, rf: 0.04, beta: 1.1, erp: 0.05, crp: 0, lambda_crp: 1, kd: 0.07, peso_deuda: 0.3 };

  const $ = s => document.querySelector(s);
  const fmt = (v, d = 2) => v == null || isNaN(v) ? "—" : Number(v).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  const musd = v => v == null ? "—" : (Math.abs(v) >= 1000 ? fmt(v / 1000, 1) + " B" : fmt(v, 0) + " M");
  const fecha = ts => ts ? new Date(ts * 1000).toLocaleDateString("es-AR", { day: "2-digit", month: "short" }) : "—";
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let D, sel = null, over = {}, sintetico = false;

  function cargar() {
    const raw = $("#datos").textContent.trim();
    if (raw && !raw.startsWith("/*")) return Promise.resolve(JSON.parse(raw));
    return fetch("data.json", { cache: "no-store" }).then(r => r.json());
  }
  const refBrent = () => {
    const b = D.brent, c = b.curva || [];
    if (D.brent_referencia === "spot") return b.spot.at(-1)[1];
    if (D.brent_referencia === "promedio_curva_12m") return c.slice(0, 12).reduce((s, x) => s + x.precio, 0) / Math.min(12, c.length);
    return b.primera_linea?.precio;
  };

  function tape() {
    const b = D.brent, sp = b.spot?.at(-1), c = b.curva || [];
    const c12 = c.slice(0, 12), prom = c12.reduce((s, x) => s + x.precio, 0) / (c12.length || 1);
    const ok = D.empresas.filter(e => e.resultado.estado === "ok").length;
    $("#tape").innerHTML = [
      ["Brent spot (Dated)", fmt(sp?.[1]), `FRED · ${sp?.[0] ?? "—"}`],
      ["Brent 1ª línea", fmt(b.primera_linea?.precio), `ICE · ${fecha(b.primera_linea?.ts)}`],
      ["Curva: promedio 12 m", fmt(prom), `${c12.length} contratos · ${c12[0]?.vencimiento ?? ""} a ${c12.at(-1)?.vencimiento ?? ""}`],
      ["USD / BRL", fmt(D.fx?.usd_brl, 4), "BCB PTAX venta"],
      ["Empresas calibradas", `${ok} / ${D.empresas.length}`, "con inputs completos y citados"]
    ].map(([l, v, s]) => `<div><span class="lbl">${l}</span><span class="v">${v}</span><span class="s">${esc(s)}</span></div>`).join("");
    const gap = sp && b.primera_linea ? sp[1] - b.primera_linea.precio : null;
    $("#estado-banner").innerHTML = ok === 0
      ? `<strong>Todavía no hay implícitos.</strong> Los datos de mercado y de balance se actualizan solos. Lo que falta son los inputs operativos (producción, costos, capex, reservas, diferencial) y los parámetros de WACC, que el equipo carga con su fuente en <span class="mono">inputs/operativos.csv</span>. ${gap != null && Math.abs(gap) > 5 ? `Ojo: hoy el spot y la 1ª línea difieren en USD ${fmt(gap, 1)}, así que la elección de qué Brent se usa como referencia cambia la lectura.` : ""}`
      : `<strong>${ok} de ${D.empresas.length} empresas calibradas automáticamente.</strong> Referencia: Brent ${D.brent_referencia.replace(/_/g, " ")}. Leer con cuidado: en el caso base la producción es plana y el horizonte termina con las reservas probadas, así que el valor de los recursos no probados no entra y el implícito tiende a salir alto. Las integradas cargan además una estimación gruesa de su downstream.`;
  }

  function rail() {
    const c = D.brent.curva || [], sp = D.brent.spot?.at(-1)?.[1];
    const W = 900, H = 300, L = 48, R = 170, T = 16, B = 34;
    const vals = [...c.map(x => x.precio), sp, ...D.empresas.map(e => e.resultado.brent_implicito).filter(Boolean)].filter(v => v != null);
    const lo = Math.floor((Math.min(...vals) - 10) / 10) * 10, hi = Math.ceil((Math.max(...vals) + 10) / 10) * 10;
    const y = v => T + (hi - v) / (hi - lo) * (H - T - B), n = c.length + 1, x = k => L + k / (n - 1 || 1) * (W - L - R);
    let g = "";
    for (let v = lo; v <= hi; v += 10) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    c.forEach((p, k) => { if (k % 3 === 0) g += `<text x="${x(k + 1)}" y="${H - 12}" text-anchor="middle">${p.vencimiento.slice(2).replace("-", "/")}</text>`; });
    const pts = c.map((p, k) => `${x(k + 1)},${y(p.precio)}`).join(" ");
    g += `<polyline points="${pts}" fill="none" stroke="var(--crude)" stroke-width="2.5"/>`;
    if (sp != null) g += `<circle cx="${x(0)}" cy="${y(sp)}" r="5" fill="var(--crude)"/><text x="${x(0) + 9}" y="${y(sp) + 4}" style="fill:var(--crude)">spot ${fmt(sp, 1)}</text>`;
    const xr = W - R + 18; let pend = 0;
    g += `<line x1="${xr - 8}" x2="${xr - 8}" y1="${T}" y2="${H - B}" stroke="var(--line)"/>`;
    D.empresas.forEach(e => {
      const v = e.resultado.brent_implicito;
      if (v != null) g += `<line x1="${L}" x2="${xr - 8}" y1="${y(v)}" y2="${y(v)}" stroke="var(--accent)" stroke-dasharray="3 4"/><text x="${xr}" y="${y(v) + 4}" style="fill:var(--accent)">${e.id} ${fmt(v, 1)}</text>`;
      else { g += `<text x="${xr}" y="${T + 12 + pend * 17}">${e.id} · pendiente</text>`; pend++; }
    });
    $("#rail").innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Curva de futuros Brent e implícitos por empresa">${g}<text x="${L}" y="${T - 4}">USD/bbl</text></svg>`;
  }

  function spark(serie) {
    if (!serie?.length) return "";
    const v = serie.map(p => p[1]), mn = Math.min(...v), mx = Math.max(...v), w = 280, h = 36;
    const pts = v.map((p, k) => `${(k / (v.length - 1) * w).toFixed(1)},${(h - 2 - (p - mn) / (mx - mn || 1) * (h - 4)).toFixed(1)}`);
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polygon points="0,${h} ${pts.join(" ")} ${w},${h}" fill="var(--accent-soft)"/><polyline points="${pts.join(" ")}" fill="none" stroke="var(--accent)" stroke-width="1.5"/></svg>`;
  }
  const chipPerfil = e => `<span class="chip ${e.perfil === "pure-play" ? "pure" : "int"}">${e.perfil === "pure-play" ? "Pure-play" : "Integrada"}</span>`;
  const chipEstado = e => e.resultado.estado === "ok" ? `<span class="chip ok">Calibrada</span>` : `<span class="chip pend">Faltan ${e.resultado.faltan?.length ?? "?"} inputs</span>`;

  function cards() {
    $("#cards").innerHTML = D.empresas.map(e => `
      <button class="card" data-id="${e.id}" aria-label="Abrir ${esc(e.nombre)}">
        <div class="head"><div><h3>${esc(e.nombre)}</h3><span class="tk">${esc(e.ticker_precio)} · ${esc(e.mercado ? e.region : "")}</span></div>${chipPerfil(e)}</div>
        ${spark(e.mercado.serie_1y)}
        <div class="kv">
          <div><span class="lbl">Cotización</span><span class="v">${esc(e.mercado.moneda || "")} ${fmt(e.mercado.precio)}</span></div>
          <div><span class="lbl">Capitalización</span><span class="v">USD ${musd(e.mercado.cap_musd)}</span></div>
        </div>
        <div class="implied"><span class="lbl">Brent implícito</span><span class="v">${e.resultado.brent_implicito != null ? fmt(e.resultado.brent_implicito, 1) : "—"}</span>${chipEstado(e)}</div>
      </button>`).join("");
    document.querySelectorAll(".card").forEach(b => b.onclick = () => { abrir(b.dataset.id); tab("empresa"); });
  }

  function tab(id) {
    document.querySelectorAll("nav.tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.tab === id));
    document.querySelectorAll("section[role=tabpanel]").forEach(s => s.hidden = s.id !== id);
    try { localStorage.setItem("bi_tab", id); } catch (e) {}
  }

  const emp = () => D.empresas.find(e => e.id === sel);
  function valores() {
    const e = emp(), v = {};
    Object.keys(CAMPOS).forEach(k => {
      if (sintetico) v[k] = { valor: over[k] ?? SINT[k], origen: "sintetico" };
      else if (over[k] != null) v[k] = { valor: over[k], origen: e.inputs[k]?.origen ?? "faltante", editado: true, fuente: e.inputs[k]?.fuente };
      else if (e.inputs[k]) v[k] = { ...e.inputs[k] };
      else v[k] = { valor: null, origen: "faltante" };
    });
    return v;
  }

  function abrir(id) {
    sel = id; over = {}; sintetico = false;
    $("#sel").innerHTML = D.empresas.map(e => `<button aria-pressed="${e.id === id}" data-id="${e.id}">${e.id}</button>`).join("");
    document.querySelectorAll("#sel button").forEach(b => b.onclick = () => abrir(b.dataset.id));
    const e = emp();
    $("#ficha").innerHTML = `
      <div class="chips" style="margin-bottom:10px">${chipPerfil(e)}<span class="chip">${esc(e.region)}</span><span class="chip">Despejabilidad: ${esc(e.despejabilidad)}</span></div>
      <h2 style="font-size:26px">${esc(e.nombre)}</h2><p class="note">${esc(e.razon_social)} · ${esc(e.mercado ? e.mercado.fuente : "")}</p>
      <p>${esc(e.descripcion)}</p>
      <p><b>Por qué está en el panel.</b> ${esc(e.por_que_esta)}</p>
      <p><b>Cuidado.</b> ${esc(e.cuidado)}</p>
      ${e.dato_fuente ? `<p class="note">Dato verificado: ${esc(e.dato_fuente.texto)} — <a href="${esc(e.dato_fuente.url)}" target="_blank" rel="noopener">fuente</a></p>` : ""}
      <div class="kv" style="margin-top:12px">
        <div><span class="lbl">Cotización</span><span class="v">${esc(e.mercado.moneda || "")} ${fmt(e.mercado.precio)}</span></div>
        <div><span class="lbl">Capitalización</span><span class="v">USD ${musd(e.mercado.cap_musd)}</span></div>
        <div><span class="lbl">Referencia natural</span><span>${esc(e.referencia_natural)}</span></div>
        <div><span class="lbl">Fundamentals</span><span>${{ sec_xbrl: "SEC XBRL + yfinance (auto)", cvm_itr: "CVM ITR + yfinance (auto)", yf_se: "yfinance + Secretaría de Energía (auto)" }[e.fuente_fundamentals]}</span></div>
      </div>
      <p class="note" style="margin-top:10px">${e.mercado.nota_cap ? "Capitalización: " + esc(e.mercado.nota_cap) + "." : "Capitalización pendiente: falta cargar las acciones en circulación (6-K)."} <a href="${esc(e.ir_url)}" target="_blank" rel="noopener">Relación con inversores</a></p>`;
    tablaInputs(); calcular();
  }

  function tablaInputs() {
    const v = valores();
    $("#inputs").innerHTML = `<thead><tr><th>Input</th><th>Unidad</th><th>Valor</th><th>Origen</th><th>Fuente</th></tr></thead><tbody>` +
      Object.entries(CAMPOS).map(([k, [lab, u]]) => {
        const x = v[k], val = x.valor == null ? "" : (PCT.has(k) ? +(x.valor * 100).toFixed(4) : +(+x.valor).toFixed(4));
        const cls = x.valor == null ? "miss" : (x.editado ? "edited" : "");
        const url = String(x.fuente || "").match(/https?:\/\/\S+/);
        const fte = (x.fuente ? (url ? `<a href="${esc(url[0])}" target="_blank" rel="noopener">${esc(String(x.fuente).startsWith("http") ? "link" : String(x.fuente).split(/https?:/)[0] || "link")}</a>` : esc(x.fuente)) : "") + (x.nota && !sintetico ? `<div>${esc(x.nota)}</div>` : "") + (x.fecha ? `<div class="mono">${esc(x.fecha)}</div>` : "");
        return `<tr><td>${lab}</td><td class="mono">${u}</td><td><input id="in-${k}" data-k="${k}" class="${cls}" inputmode="decimal" value="${val}" placeholder="—" aria-label="${lab}"></td>
          <td><span class="orig ${x.origen}">${{ edgar: "EDGAR", automatico: "Automático", derivado: "Calculado", macro: "Mercado", semilla: "Reporte citado", supuesto: "Supuesto", parametro: "Parámetro", equipo: "Equipo", faltante: "Falta", sintetico: "Sintético" }[x.origen]}</span></td><td class="note">${fte}</td></tr>`;
      }).join("") + "</tbody>";
    document.querySelectorAll("#inputs input").forEach(inp => inp.oninput = () => {
      const k = inp.dataset.k, raw = inp.value.replace(",", ".");
      if (raw === "") delete over[k]; else if (!isNaN(+raw)) over[k] = PCT.has(k) ? +raw / 100 : +raw;
      inp.classList.toggle("edited", raw !== ""); inp.classList.toggle("miss", raw === "" && !valores()[k].valor);
      calcular();
    });
  }

  function calcular() {
    const e = emp(), v = valores(), i = {}; const faltan = [];
    Object.keys(CAMPOS).forEach(k => { if (v[k].valor == null) faltan.push(CAMPOS[k][0]); else i[k] = +v[k].valor; });
    const acc = e.inputs.acciones_mm?.valor ?? e.fundamentals.acciones_mm;
    let cap = sintetico ? null : e.mercado.cap_musd;
    const box = $("#resultado");
    if (faltan.length || (!cap && !sintetico)) {
      box.innerHTML = `<h2>Brent implícito</h2><div class="result"><span class="big">—</span><span>Faltan ${faltan.length} inputs para correr el despeje${!cap ? " y la capitalización" : ""}.</span></div>
        <p class="note">Faltan: ${faltan.slice(0, 12).join(", ")}${faltan.length > 12 ? "…" : ""}</p>
        <p class="note">Podés completarlos a mano arriba para simular, o probar el caso sintético para ver cómo responde la herramienta.</p>`;
      return;
    }
    if (sintetico) cap = M.valorPatrimonio(i, 75);
    const bi = M.brentImplicito(i, cap), bd = M.banda(i, cap), sens = M.sensibilidad(i, cap).slice(0, 5), ref = refBrent();
    const lectura = bi.valor == null ? "" : bi.valor > ref ? `El mercado paga un Brent <b>por encima</b> de la referencia (${fmt(ref, 1)}): escenario optimista incorporado.` : `El mercado paga un Brent <b>por debajo</b> de la referencia (${fmt(ref, 1)}): hay margen si el crudo no cae.`;
    const est = { debajo: "El valor del modelo supera la capitalización aun con Brent USD 10: revisar inputs.", encima: "Ni con Brent USD 300 el modelo alcanza la capitalización: revisar inputs.", no_monotono: "El valor no crece con el Brent: no hay despeje informativo." }[bi.estado] || "";
    box.innerHTML = `<h2>Brent implícito</h2>
      ${sintetico ? `<div class="banner warn" style="margin:8px 0"><strong>Caso sintético.</strong> Inputs de prueba y capitalización fabricada para que el despeje dé 75. No representa a ${esc(e.nombre)}.</div>` : ""}
      <div class="result"><span class="big">${bi.valor != null ? fmt(bi.valor, 1) : "—"}</span>
        <span>USD/bbl · banda ${fmt(bd.min, 1)} – ${fmt(bd.max, 1)} · WACC ${fmt(M.wacc(i) * 100, 1)} %</span><span>${lectura}${est}</span></div>
      <h3 style="font-size:15px;margin-top:14px">Qué mueve el resultado (input ±10 %)</h3>
      <div class="tbl"><table><thead><tr><th>Input</th><th>−10 %</th><th>+10 %</th></tr></thead><tbody>
      ${sens.map(s => `<tr><td>${CAMPOS[s.input][0]}</td><td class="num">${fmt(s.menos10, 1)}</td><td class="num">${fmt(s.mas10, 1)}</td></tr>`).join("")}</tbody></table></div>
      <div class="range" style="margin-top:14px"><label class="lbl" for="proy">Modo proyección · Brent <span class="num" id="proy-v">${fmt(ref, 0)}</span></label>
        <input type="range" id="proy" min="30" max="160" step="1" value="${Math.round(ref)}"><div id="proy-out" class="num"></div></div>`;
    const upd = () => {
      const b = +$("#proy").value; $("#proy-v").textContent = b;
      if (sintetico || !acc) { $("#proy-out").textContent = `Valor del patrimonio: USD ${musd(M.valorPatrimonio(i, b))}`; return; }
      const fx = e.moneda_cotizacion === "BRL" ? D.fx.usd_brl : 1;
      const p = M.precioObjetivo(i, b, acc, e.ratio_adr_acciones, fx);
      $("#proy-out").innerHTML = `Precio objetivo: ${e.moneda_cotizacion} ${fmt(p)} <span class="note">(hoy ${fmt(e.mercado.precio)})</span>`;
    };
    $("#proy").oninput = upd; upd();
  }

  function fuentes() {
    $("#gen").textContent = `data.json generado ${new Date(D.generado).toLocaleString("es-AR")}`;
    const nom = { "mercado.json": "Cotizaciones (Yahoo Finance)", "brent.json": "Brent spot FRED + curva ICE", "fx.json": "USD/BRL (BCB PTAX)", "fund_sec.json": "Balances EOG, COP (SEC XBRL)", "fund_cvm.json": "Balances PRIO, Petrobras (CVM)", "fund_yf.json": "Estados financieros de las 6 (yfinance)", "ar_se.json": "Producción y reservas operadas VIST, YPF (Secretaría de Energía)", "edgar.json": "Releases y 10-Q/10-K (SEC EDGAR)", "macro.json": "rf, ERP, riesgo país, betas (FRED, Damodaran) y Medanito (SE)" };
    $("#t-fuentes").innerHTML = `<thead><tr><th>Fuente</th><th>Estado</th><th>Última actualización</th></tr></thead><tbody>` +
      D.fuentes_estado.map(f => `<tr><td>${nom[f.archivo] || f.archivo}</td><td><span class="st ${f.estado === "ok" ? "ok" : f.estado === "desactualizado" ? "desactualizado" : "sin"}"></span>${f.estado}</td><td class="mono">${f.actualizado ? new Date(f.actualizado).toLocaleString("es-AR") : "—"}</td></tr>`).join("") +
      `<tr><td>Inputs editados por el equipo (inputs/operativos.csv)</td><td><span class="st ${D.empresas.some(e => Object.values(e.inputs).some(v => v.origen === "equipo")) ? "ok" : "sin"}"></span>${D.empresas.some(e => Object.values(e.inputs).some(v => v.origen === "equipo")) ? "con datos" : "sin cargar"}</td><td class="mono">—</td></tr></tbody>`;
    $("#t-fund").innerHTML = `<thead><tr><th>Empresa</th><th>Cierre</th><th>Deuda</th><th>Caja</th><th>Deuda neta</th><th>Acciones (MM)</th><th>Fuente</th></tr></thead><tbody>` +
      D.empresas.map(e => { const f = e.fundamentals; return `<tr><td><b>${e.id}</b></td><td class="mono">${f.fecha ?? "—"}</td><td class="num">${musd(f.deuda_musd)}</td><td class="num">${musd(f.caja_musd)}</td><td class="num">${musd(f.deuda_neta_musd ?? e.inputs.deuda_neta_musd?.valor)}</td><td class="num">${fmt(f.acciones_mm ?? e.inputs.acciones_mm?.valor, 1)}</td><td class="note">${esc(f.fuente || (e.inputs.deuda_neta_musd?.fuente ?? "—"))}</td></tr>`; }).join("") + "</tbody>";
  }

  function docsEdgar() {
    const filas = Object.entries(D.edgar || {}).flatMap(([e, r]) => Object.entries(r.docs || {}).map(([k, d]) =>
      `<tr><td><b>${e}</b></td><td>${esc(k)}</td><td class="mono">${esc(d.periodo)}</td><td class="mono">${esc(d.fecha)}</td><td><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.url.split("/").pop())}</a></td><td class="note">${(r.fallas || []).length ? esc(r.fallas.join("; ")) : "todos los campos leídos"}</td></tr>`));
    $("#t-edgar").innerHTML = `<thead><tr><th>Empresa</th><th>Documento</th><th>Período</th><th>Publicado</th><th>Archivo</th><th>Lectura</th></tr></thead><tbody>${filas.join("")}</tbody>`;
  }

  let filtroArea = "Todas";
  function notas() {
    const N = D.notas || { importante: [], pendientes: [] };
    const abiertos = N.pendientes.filter(p => p.estado !== "resuelto");
    $("#n-pend").textContent = abiertos.length;
    $("#notas-fecha").textContent = `Actualizado ${N.actualizado || "—"} · ${abiertos.length} pendientes abiertos (${abiertos.filter(p => p.prioridad === "alta").length} de prioridad alta). Se edita en config/pendientes.json.`;
    $("#n-imp").innerHTML = N.importante.map(x => `<div class="imp"><h3>${esc(x.titulo)}</h3><p>${esc(x.texto)}</p></div>`).join("");
    const orden = { alta: 0, media: 1, baja: 2 };
    const areas = ["Todas", ...new Set(N.pendientes.map(p => p.area))];
    const lista = N.pendientes.filter(p => filtroArea === "Todas" || p.area === filtroArea)
      .sort((a, b) => (a.estado === "resuelto") - (b.estado === "resuelto") || orden[a.prioridad] - orden[b.prioridad]);
    $("#n-pen").innerHTML = `<div class="filtros">${areas.map(a => `<button aria-pressed="${a === filtroArea}" data-a="${esc(a)}">${esc(a)}</button>`).join("")}</div>` +
      lista.map(p => `<div class="pen ${p.estado === "resuelto" ? "resuelto" : ""}"><span class="pri ${p.prioridad}">${p.prioridad}</span><span class="txt">${esc(p.tarea)}<span class="area">${esc(p.area)}</span></span><span class="est">${esc(p.estado)}</span></div>`).join("");
    document.querySelectorAll("#n-pen .filtros button").forEach(b => b.onclick = () => { filtroArea = b.dataset.a; notas(); });
    // alertas generadas por los datos de hoy
    const al = [];
    D.empresas.forEach(e => {
      const sup = Object.entries(e.inputs).filter(([, v]) => v.origen === "supuesto").map(([k]) => CAMPOS[k]?.[0] || k);
      if (sup.length) al.push(["media", `${e.id}: ${sup.length} inputs con supuesto — ${sup.join(", ")}`]);
      Object.entries(e.inputs).filter(([, v]) => v.nota && /⚠️|OPERAD|revisar/i.test(v.nota)).forEach(([k, v]) => al.push(["media", `${e.id} · ${CAMPOS[k]?.[0] || k}: ${v.nota}`]));
      if (e.mercado.nota_cap && e.mercado.nota_cap.includes("⚠️")) al.push(["alta", `${e.id}: ${e.mercado.nota_cap}`]);
      if (e.resultado.estado !== "ok") al.push(["alta", `${e.id}: sin despeje (${e.resultado.estado}${e.resultado.faltan ? " — faltan " + e.resultado.faltan.join(", ") : ""})`]);
    });
    Object.entries(D.edgar || {}).forEach(([e, r]) => (r.fallas || []).forEach(f => al.push(["alta", `${e} · EDGAR: ${f}`])));
    (D.fuentes_estado || []).filter(f => f.estado !== "ok").forEach(f => al.push(["alta", `Fuente ${f.archivo}: ${f.estado}`]));
    $("#n-aut").innerHTML = `<p class="note">Se generan solas en cada actualización a partir de los datos de hoy.</p>` +
      (al.length ? al.map(([p, t]) => `<div class="pen"><span class="pri ${p}">${p}</span><span class="txt">${esc(t)}</span><span></span></div>`).join("") : "<p>Sin alertas.</p>");
  }
  function notasTab(id) {
    document.querySelectorAll(".dlg-tabs button").forEach(b => b.setAttribute("aria-selected", b.dataset.n === id));
    ["n-imp", "n-pen", "n-aut"].forEach(x => $("#" + x).hidden = x !== id);
  }


  // ------------------------------------------------------------------ serie histórica
  const COL = { VIST: "var(--s1)", YPF: "var(--s2)", EOG: "var(--s3)", COP: "var(--s4)", PRIO: "var(--s5)", PBR: "var(--s6)" };
  const H = { desde: null, hasta: null, ref: "brent_1l", activos: new Set() };
  function hInit() {
    const hi = D.historia; if (!hi) { $("#h-chart").innerHTML = "<p class='note'>Todavía no se generó la serie histórica (python -m pipeline.historia).</p>"; return; }
    const ids = Object.keys(hi.series).filter(e => hi.series[e].fecha.length);
    ids.forEach(e => H.activos.add(e));
    const todas = ids.flatMap(e => hi.series[e].fecha).sort();
    const f0 = todas[0], f1 = todas.at(-1);
    const menos1a = (() => { const d = new Date(f1); d.setFullYear(d.getFullYear() - 1); return d.toISOString().slice(0, 10); })();
    const presets = [["Ventana TIF 3T24–1T26", "2024-07-01", "2026-03-31"], ["Último año", menos1a, f1], ["Todo", f0, f1]];
    try { const g = JSON.parse(localStorage.getItem("bi_rango") || "null"); if (g) { H.desde = g[0]; H.hasta = g[1]; } } catch (e) {}
    H.desde = H.desde || "2024-07-01"; H.hasta = H.hasta || f1;
    $("#h-desde").min = $("#h-hasta").min = f0; $("#h-desde").max = $("#h-hasta").max = f1;
    $("#h-desde").value = H.desde; $("#h-hasta").value = H.hasta;
    $("#h-presets").innerHTML = presets.map(([n, a, b]) => `<button class="btn" data-a="${a}" data-b="${b}">${n}</button>`).join("");
    document.querySelectorAll("#h-presets button").forEach(b => b.onclick = () => { H.desde = b.dataset.a; H.hasta = b.dataset.b; $("#h-desde").value = H.desde; $("#h-hasta").value = H.hasta; hDraw(); });
    $("#h-desde").onchange = () => { H.desde = $("#h-desde").value; hDraw(); };
    $("#h-hasta").onchange = () => { H.hasta = $("#h-hasta").value; hDraw(); };
    $("#h-ref").onchange = () => { H.ref = $("#h-ref").value; hDraw(); };
    $("#h-emp").innerHTML = D.empresas.map(e => `<button data-e="${e.id}" aria-pressed="${H.activos.has(e.id)}" ${ids.includes(e.id) ? "" : "disabled title='Sin serie'"}><i style="background:${COL[e.id]}"></i>${e.id}</button>`).join("");
    document.querySelectorAll("#h-emp button").forEach(b => b.onclick = () => { const e = b.dataset.e; H.activos.has(e) ? H.activos.delete(e) : H.activos.add(e); b.setAttribute("aria-pressed", H.activos.has(e)); hDraw(); });
    const inicio = Object.fromEntries(ids.map(e => [e, hi.series[e].fecha[0]]));
    $("#h-nota").textContent = "Cobertura: " + D.empresas.map(e => `${e.id} desde ${inicio[e.id] || "—"}`).join(" · ") +
      ". PRIO no está en la SEC (solo su último release citado); Petrobras publicó los reportes de producción anteriores a 2T25 como PDF, que EDGAR no deja leer como texto.";
    hDraw();
  }
  const enRango = f => f >= H.desde && f <= H.hasta;
  function refSerie() { const r = D.historia[H.ref]; return Object.fromEntries(r.fecha.map((f, i) => [f, r.valor[i]])); }
  function refAl(ref, fechasOrd, f) { let lo = 0, hi = fechasOrd.length - 1, best = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (fechasOrd[m] <= f) { best = fechasOrd[m]; lo = m + 1; } else hi = m - 1; } return best ? ref[best] : null; }
  function hDraw() {
    try { localStorage.setItem("bi_rango", JSON.stringify([H.desde, H.hasta])); } catch (e) {}
    const hi = D.historia, act = [...H.activos].filter(e => hi.series[e]?.fecha.length);
    const ref = refSerie(), refF = Object.keys(ref).sort();
    const fechas = [...new Set([...refF.filter(enRango), ...act.flatMap(e => hi.series[e].fecha.filter(enRango))])].sort();
    if (fechas.length < 2) { $("#h-chart").innerHTML = "<p class='note'>No hay datos en ese rango.</p><div class='tip' id='h-tip' hidden></div>"; hTest(act, ref, refF); return; }
    const W = 1000, Hh = 400, L = 46, R = 118, T = 14, B = 52;
    const t = f => Date.parse(f), t0 = t(fechas[0]), t1 = t(fechas.at(-1));
    const x = f => L + (t(f) - t0) / (t1 - t0 || 1) * (W - L - R);
    const vis = [...fechas.map(f => ref[f]).filter(v => v != null)];
    act.forEach(e => { const s = hi.series[e]; s.fecha.forEach((f, i) => { if (enRango(f) && s.implicito[i] != null) { vis.push(s.implicito[i]); if (act.length === 1) { vis.push(s.banda_min[i], s.banda_max[i]); } } }); });
    const lo = Math.floor(Math.min(...vis) / 20) * 20, hiV = Math.ceil(Math.max(...vis) / 20) * 20;
    const y = v => T + (hiV - v) / (hiV - lo || 1) * (Hh - T - B);
    let g = "";
    for (let v = lo; v <= hiV; v += 20) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
    const meses = []; { const d = new Date(fechas[0].slice(0, 7) + "-01"); while (d <= new Date(fechas.at(-1))) { meses.push(d.toISOString().slice(0, 10)); d.setMonth(d.getMonth() + 1); } }
    const paso = Math.max(1, Math.ceil(meses.length / 12));
    meses.forEach((m, k) => { if (m >= fechas[0] && k % paso === 0) g += `<line x1="${x(m)}" x2="${x(m)}" y1="${Hh - B}" y2="${Hh - B + 4}" stroke="var(--muted)"/><text x="${x(m)}" y="${Hh - B + 16}" text-anchor="middle">${m.slice(5, 7)}/${m.slice(2, 4)}</text>`; });
    const path = pts => { let d = "", pen = false; pts.forEach(([f, v]) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(f).toFixed(1)},${y(v).toFixed(1)}`; pen = true; }); return d; };
    // banda (una sola empresa)
    if (act.length === 1) {
      const s = hi.series[act[0]], idx = s.fecha.map((f, i) => i).filter(i => enRango(s.fecha[i]) && s.banda_min[i] != null);
      if (idx.length) g += `<path d="M${idx.map(i => `${x(s.fecha[i]).toFixed(1)},${y(s.banda_max[i]).toFixed(1)}`).join("L")}L${idx.slice().reverse().map(i => `${x(s.fecha[i]).toFixed(1)},${y(s.banda_min[i]).toFixed(1)}`).join("L")}Z" fill="${COL[act[0]]}" opacity=".15"/>`;
    }
    g += `<path d="${path(refF.filter(enRango).map(f => [f, ref[f]]))}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-dasharray="${H.ref === "brent_1l" ? "0" : "5 3"}"/>`;
    const finales = [["Brent", "var(--ink)", (() => { const f = refF.filter(enRango).at(-1); return f ? ref[f] : null; })()]];
    act.forEach(e => { const s = hi.series[e]; const pts = s.fecha.map((f, i) => [f, s.implicito[i]]).filter(([f]) => enRango(f));
      g += `<path d="${path(pts)}" fill="none" stroke="${COL[e]}" stroke-width="2" stroke-linejoin="round"/>`;
      const ult = pts.filter(p => p[1] != null).at(-1); if (ult) finales.push([e, COL[e], ult[1]]);
      // recalibraciones
      (hi.calibraciones[e] || []).filter(k => !k.faltan.length && enRango(k.publicado)).forEach(k => g += `<path d="M${x(k.publicado)},${Hh - B - 1}l-4,-7h8z" fill="${COL[e]}"><title>${e}: entra el balance ${k.periodo} (publicado ${k.publicado})</title></path>`);
    });
    // etiquetas directas al final, separadas
    finales.filter(f => f[2] != null).map(f => ({ n: f[0], c: f[1], yy: y(f[2]), v: f[2] })).sort((a, b) => a.yy - b.yy)
      .reduce((prev, it) => { it.yy = Math.max(it.yy, prev + 13); g += `<text x="${W - R + 6}" y="${it.yy + 4}" style="fill:var(--ink);font-weight:600"><tspan style="fill:${it.c}">■</tspan> ${esc(it.n)} ${fmt(it.v, 0)}</text>`; return it.yy; }, -99);
    g += `<text x="${L}" y="${T - 2}">USD/bbl</text><line id="h-cross" x1="0" x2="0" y1="${T}" y2="${Hh - B}" stroke="var(--muted)" stroke-dasharray="3 3" visibility="hidden"/>`;
    g += `<rect id="h-hit" x="${L}" y="${T}" width="${W - L - R}" height="${Hh - T - B}" fill="transparent"/>`;
    $("#h-chart").innerHTML = `<svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Brent implícito diario por empresa y Brent de referencia">${g}</svg><div class="tip" id="h-tip" hidden></div>`;
    const svg = $("#h-chart svg"), tip = $("#h-tip"), cross = $("#h-cross");
    const idxs = Object.fromEntries(act.map(e => [e, Object.fromEntries(hi.series[e].fecha.map((f, i) => [f, i]))]));
    $("#h-hit").onmousemove = ev => {
      const r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) / r.width * W;
      const tt = t0 + (px - L) / (W - L - R) * (t1 - t0); let f = fechas[0];
      for (const ff of fechas) { if (t(ff) <= tt) f = ff; else break; }
      cross.setAttribute("x1", x(f)); cross.setAttribute("x2", x(f)); cross.setAttribute("visibility", "visible");
      const filas = [[`Brent ${H.ref === "brent_1l" ? "1ª línea" : "spot"}`, refAl(ref, refF, f), "var(--ink)"], ...act.map(e => { const i = idxs[e][f]; const s = hi.series[e]; return [e + (i != null ? ` <span class="note">(${s.periodos[s.cal_idx[i]]})</span>` : ""), i != null ? s.implicito[i] : null, COL[e]]; })];
      tip.innerHTML = `<b>${f}</b>` + filas.map(([n, v, c]) => `<div><span><span style="color:${c}">■</span> ${n}</span><span>${fmt(v, 1)}</span></div>`).join("");
      tip.hidden = false; const cw = $("#h-chart").clientWidth; const lx = (x(f) / W) * r.width;
      tip.style.left = Math.min(lx + 12, cw - 200) + "px"; tip.style.top = "12px";
    };
    $("#h-hit").onmouseleave = () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); };
    hTest(act, ref, refF); hCal();
  }
  function hTest(act, ref, refF) {
    const hi = D.historia;
    const corr = (a, b) => { const n = a.length; if (n < 3) return null; const ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n;
      let sab = 0, sa = 0, sb = 0; for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); sa += (a[i] - ma) ** 2; sb += (b[i] - mb) ** 2; } return sab / Math.sqrt(sa * sb); };
    const filas = act.map(e => { const s = hi.series[e]; const pares = s.fecha.map((f, i) => [f, s.implicito[i], refAl(ref, refF, f)]).filter(([f, v, r]) => enRango(f) && v != null && r != null);
      if (!pares.length) return `<tr><td><b>${e}</b></td><td colspan="6" class="note">Sin datos en el rango</td></tr>`;
      const err = pares.map(p => p[1] - p[2]), n = pares.length, sesgo = err.reduce((a, b) => a + b, 0) / n;
      const sd = Math.sqrt(err.reduce((a, b) => a + (b - sesgo) ** 2, 0) / Math.max(1, n - 1));
      const sem = pares.filter((_, i) => i % 5 === 0); const dI = [], dR = []; for (let i = 1; i < sem.length; i++) { dI.push(sem[i][1] - sem[i - 1][1]); dR.push(sem[i][2] - sem[i - 1][2]); }
      const c = corr(dI, dR), mi = pares.reduce((a, p) => a + p[1], 0) / n, mr = pares.reduce((a, p) => a + p[2], 0) / n;
      return `<tr><td><b>${e}</b></td><td class="num">${n}</td><td class="num">${fmt(mi, 1)}</td><td class="num">${fmt(mr, 1)}</td><td class="num">${sesgo >= 0 ? "+" : ""}${fmt(sesgo, 1)}</td><td class="num">${fmt(sd, 1)}</td><td class="num">${c == null ? "—" : fmt(c, 2)}</td></tr>`; });
    $("#h-test").innerHTML = `<thead><tr><th>Empresa</th><th>Días</th><th>Implícito medio</th><th>Referencia media</th><th>Sesgo</th><th>Desvío del error</th><th>Correl. variaciones semanales</th></tr></thead><tbody>${filas.join("")}</tbody>`;
  }
  function hCal() {
    const hi = D.historia;
    $("#h-cal").innerHTML = `<thead><tr><th>Empresa</th><th>Trimestre</th><th>Publicado</th><th>Estado</th><th>Arrastrados</th><th>Documentos</th></tr></thead><tbody>` +
      Object.entries(hi.calibraciones).flatMap(([e, ls]) => ls.filter(k => enRango(k.publicado) || (k.publicado < H.desde)).slice(-12).map(k =>
        `<tr><td><b>${e}</b></td><td class="mono">${k.periodo}</td><td class="mono">${k.publicado}</td><td>${k.faltan.length ? `<span class="chip pend">faltan ${k.faltan.length}</span>` : `<span class="chip ok">completa</span>`}</td><td class="note">${esc(k.arrastrados.join(", ")) || "—"}</td><td class="note">${Object.entries(k.docs || {}).map(([n, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(n)}</a>`).join(" · ") || "release citado"}</td></tr>`)).join("") + "</tbody>";
  }

  cargar().then(d => {
    D = d; tape(); rail(); cards(); fuentes(); docsEdgar(); notas(); hInit();
    $("#b-notas").onclick = () => { const dl = $("#notas"); if (dl.showModal) dl.showModal(); else dl.setAttribute("open", ""); };
    $("#b-cerrar").onclick = () => $("#notas").close ? $("#notas").close() : $("#notas").removeAttribute("open");
    $("#notas").addEventListener("click", ev => { if (ev.target.id === "notas") $("#notas").close(); });
    document.querySelectorAll(".dlg-tabs button").forEach(b => b.onclick = () => notasTab(b.dataset.n)); abrir(D.empresas[0].id);
    document.querySelectorAll("nav.tabs button").forEach(b => b.onclick = () => tab(b.dataset.tab));
    $("#b-reset").onclick = () => { over = {}; sintetico = false; tablaInputs(); calcular(); };
    $("#b-sint").onclick = () => { over = {}; sintetico = true; tablaInputs(); calcular(); };
    let t = null; try { t = localStorage.getItem("bi_tab"); } catch (e) {}
    if (t && document.getElementById(t)) tab(t);
  }).catch(err => { document.querySelector("main").innerHTML = `<div class="banner warn"><strong>No se pudieron cargar los datos.</strong> ${esc(err.message)}. Corré <span class="mono">python -m pipeline.run_all</span> para generar data.json.</div>`; });
})();
