/* Gráficos nativos de Excel: ExcelJS no los genera, así que se inyecta DrawingML en el .xlsx. Las series son referencias a celdas
   (c:f), de modo que los gráficos quedan conectados: si cambia una celda, cambia el gráfico. */
(function () {
  const JSZIP = "https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js";
  let cargando = null;
  function jszip() {
    if (window.JSZip) return Promise.resolve(window.JSZip);
    return cargando || (cargando = new Promise((ok, mal) => {
      const s = document.createElement("script"); s.src = JSZIP; s.async = true;
      s.onload = () => ok(window.JSZip); s.onerror = () => { cargando = null; mal(new Error("no se pudo cargar JSZip (¿sin conexión?)")); };
      document.head.appendChild(s);
    }));
  }
  const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const texto = (t, sz, b) => `<c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${sz}" b="${b ? 1 : 0}"/></a:pPr><a:r><a:rPr lang="es-AR" sz="${sz}" b="${b ? 1 : 0}"/><a:t>${esc(t)}</a:t></a:r></a:p></c:rich></c:tx>`;
  const titulo = (t, sz = 1200, b = true) => `<c:title>${texto(t, sz, b)}<c:overlay val="0"/></c:title>`;
  const FUENTE = `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"/></a:pPr><a:endParaRPr lang="es-AR"/></a:p></c:txPr>`;
  const GRILLA = `<c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E3E6E8"/></a:solidFill></a:ln></c:spPr></c:majorGridlines>`;

  function serie(s, i, tipo) {
    const nombre = s.nombreRef ? `<c:tx><c:strRef><c:f>${esc(s.nombreRef)}</c:f></c:strRef></c:tx>` : `<c:tx><c:v>${esc(s.nombre)}</c:v></c:tx>`;
    const cat = s.catTexto ? `<c:cat><c:strRef><c:f>${esc(s.cat)}</c:f></c:strRef></c:cat>` : `<c:cat><c:numRef><c:f>${esc(s.cat)}</c:f></c:numRef></c:cat>`;
    const val = `<c:val><c:numRef><c:f>${esc(s.val)}</c:f></c:numRef></c:val>`;
    if (tipo === "bar")
      return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${nombre}<c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>${cat}${val}</c:ser>`;
    if (s.soloMarca)
      return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${nombre}<c:spPr><a:ln w="19050"><a:noFill/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill><a:ln w="6350"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:marker>${cat}${val}<c:smooth val="0"/></c:ser>`;
    const guion = s.guion ? `<a:prstDash val="${s.guion}"/>` : "";
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/>${nombre}<c:spPr><a:ln w="${s.ancho || 15875}" cap="rnd"><a:solidFill><a:srgbClr val="${s.color}"/></a:solidFill>${guion}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>${cat}${val}<c:smooth val="0"/></c:ser>`;
  }
  function graficoXml(g) {
    const ejeY = `<c:valAx><c:axId val="2"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/>${GRILLA}${g.ejeY ? titulo(g.ejeY, 800, false) : ""}<c:numFmt formatCode="${esc(g.fmtY || "0")}" sourceLinked="0"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${FUENTE}<c:crossAx val="1"/><c:crosses val="autoZero"/><c:crossBetween val="${g.tipo === "bar" ? "between" : "midCat"}"/></c:valAx>`;
    let plot;
    if (g.tipo === "bar") {
      plot = `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${g.series.map((s, i) => serie(s, i, "bar")).join("")}<c:gapWidth val="${g.gap ?? 60}"/><c:overlap val="${g.overlap ?? 0}"/><c:axId val="1"/><c:axId val="2"/></c:barChart>` +
        `<c:catAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>${FUENTE}<c:crossAx val="2"/><c:crosses val="autoZero"/><c:auto val="0"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="1"/></c:catAx>` + ejeY;
    } else {
      plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${g.series.map((s, i) => serie(s, i, "line")).join("")}<c:marker val="1"/><c:axId val="1"/><c:axId val="2"/></c:lineChart>` +
        `<c:dateAx><c:axId val="1"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="mmm\\-yy" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="low"/>${FUENTE}<c:crossAx val="2"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblOffset val="100"/><c:baseTimeUnit val="days"/><c:majorUnit val="${g.mesesEje || 3}"/><c:majorTimeUnit val="months"/></c:dateAx>` + ejeY;
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><c:roundedCorners val="0"/><c:chart>${titulo(g.titulo)}<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/>${plot}</c:plotArea>${g.sinLeyenda ? "" : `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${FUENTE}</c:legend>`}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="6350"><a:solidFill><a:srgbClr val="D5D9DC"/></a:solidFill></a:ln></c:spPr></c:chartSpace>`;
  }
  const ancla = (g, i) => `<xdr:twoCellAnchor><xdr:from><xdr:col>${g.pos[0]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${g.pos[1]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${g.pos[2]}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${g.pos[3]}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Grafico ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;

  /* Agrega los gráficos a la hoja `nombreHoja` de un .xlsx ya generado. */
  async function inyectar(buf, nombreHoja, graficos) {
    const JSZip = await jszip(), zip = await JSZip.loadAsync(buf);
    const wbXml = await zip.file("xl/workbook.xml").async("string"), wbRels = await zip.file("xl/_rels/workbook.xml.rels").async("string");
    const hoja = wbXml.match(new RegExp(`<sheet [^>]*name="${nombreHoja}"[^>]*/>`));
    if (!hoja) throw new Error("no está la hoja " + nombreHoja);
    const rid = hoja[0].match(/r:id="([^"]+)"/)[1];
    const rel = [...wbRels.matchAll(/<Relationship [^>]*>/g)].map(m => m[0]).find(r => r.includes(`Id="${rid}"`));
    const destino = rel.match(/Target="([^"]+)"/)[1].replace(/^\/?(xl\/)?/, "");
    const ruta = "xl/" + destino, base = destino.split("/").pop();
    let xml = await zip.file(ruta).async("string");
    if (!xml.includes('xmlns:r=')) xml = xml.replace("<worksheet ", '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    const tag = '<drawing r:id="rIdGraficos"/>';
    const corte = xml.search(/<(legacyDrawing|tableParts|extLst)\b/);
    xml = corte >= 0 ? xml.slice(0, corte) + tag + xml.slice(corte) : xml.replace("</worksheet>", tag + "</worksheet>");
    zip.file(ruta, xml);
    const rutaRels = `xl/worksheets/_rels/${base}.rels`, previo = zip.file(rutaRels) ? await zip.file(rutaRels).async("string") : null;
    const relD = '<Relationship Id="rIdGraficos" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>';
    zip.file(rutaRels, previo ? previo.replace("</Relationships>", relD + "</Relationships>") :
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relD}</Relationships>`);
    zip.file("xl/drawings/drawing1.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${graficos.map(ancla).join("")}</xdr:wsDr>`);
    zip.file("xl/drawings/_rels/drawing1.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${graficos.map((g, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${i + 1}.xml"/>`).join("")}</Relationships>`);
    graficos.forEach((g, i) => zip.file(`xl/charts/chart${i + 1}.xml`, graficoXml(g)));
    let ct = await zip.file("[Content_Types].xml").async("string");
    const extra = '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' +
      graficos.map((g, i) => `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join("");
    zip.file("[Content_Types].xml", ct.replace("</Types>", extra + "</Types>"));
    return zip.generateAsync({ type: "arraybuffer", compression: "DEFLATE" });
  }
  window.BICharts = { inyectar };
})();
