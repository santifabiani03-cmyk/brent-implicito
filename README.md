# Barril Implícito — TIF Finanzas UADE 2C2026

Web que estima el **Brent implícito** en la capitalización bursátil de VIST, YPF, EOG, COP, PRIO y PBR
(DCF E&P corrido al revés) y lo compara contra el spot, la curva de futuros y entre empresas.

## Estructura
```
config/companies.json     identificadores (CIK SEC, código CVM, ticker, ratio ADR) + ficha de cada empresa
config/parametros.json    rf, ERP, prima riesgo país, λ, Brent de referencia  ← VACÍOS: los define el equipo con fuente
inputs/operativos.csv     datos operativos por trimestre, un renglón por dato con link a la fuente (ver DICCIONARIO.md)
pipeline/                 fetchers (Yahoo, FRED, BCB PTAX, SEC XBRL, CVM ITR) + build + empaquetado
engine/model.py           motor: valuación, despeje por bisección, banda, sensibilidad, proyección
web/                      sitio estático (index.html + engine.js [réplica del motor] + app.js + data.json)
tests/                    monotonía, ida y vuelta, reservas, paridad Python↔JS
.github/workflows/        actualización diaria 19:30 ART + deploy a GitHub Pages
```

## Serie histórica
`python -m pipeline.historia` (lo corre también `run_all`) arma, para cada empresa y trimestre desde 4T2023, la calibración con el
reporte publicado ese trimestre (EDGAR con caché en `data/historia/`), y despeja el Brent implícito para cada día con la
capitalización de ese día. Regla sin look-ahead: un balance rige desde su fecha de publicación. Si un dato falta en un reporte
se arrastra el anterior (máx. 2 trimestres; reservas, 4) y queda marcado. Muestra de control: `--desde 2021-12-31`.

## Abrir la página
Doble clic en **`ABRIR PAGINA - Barril Implicito.html`** (carpeta principal). Funciona sin internet con los últimos datos guardados.
Para traer datos nuevos: doble clic en **`ACTUALIZAR DATOS (Windows).bat`** (o la versión Mac). Necesita Python instalado.

## Correr local (desarrollo)
```bash
pip install -r requirements.txt
python -m pytest -q tests/
python -m pipeline.run_all          # baja datos, corre el motor, genera web/index.html y dist/preview.html
python -m http.server -d web 8000   # abrir http://localhost:8000
```

## Qué es automático (todo, con fuente por dato)
| Input del modelo | De dónde sale | Cómo |
|---|---|---|
| Producción crudo / gas+NGL | SEC EDGAR: 10-Q/10-K (EOG, COP), release 6-K (YPF, VIST, PBR) | `pipeline/fetch_edgar.py` + `pipeline/recetas.py` |
| Precio realizado → diferencial vs Brent | EDGAR + Brent Dated promedio del trimestre (FRED); VIST: Medanito vs Brent (SE) | `pipeline/derivar.py` |
| Precio gas/NGL | EDGAR (volúmenes × precios por producto) | idem |
| Lifting, otros costos, DD&A por boe | EDGAR; si no está, estados de yfinance / producción EDGAR | idem |
| Regalías / impuestos a la producción | EDGAR (US: taxes other than income; PBR: production taxes); AR: regalías Neuquén (SE) | idem |
| Derechos de exportación | EDGAR (VIST) | idem |
| Capex, deuda neta, acciones, minoritarios, intereses | yfinance; deuda y acciones oficiales de SEC/CVM | `fetch_yf.py`, `fetch_sec.py`, `fetch_cvm.py` |
| rf, ERP, riesgo país, tasa marginal, beta, EV/EBITDA | FRED DGS10; Damodaran (ctryprem, betas, vebitda) | `fetch_macro.py` |
| Downstream de integradas | EBITDA de segmento (EDGAR) × 4 × EV/EBITDA sectorial | `derivar.py` |
| Reservas probadas | 10-K/20-F/certificación citados (`inputs/semillas.csv`); VIST/YPF: SE (operado) | anual |
| Perfil de producción | **Supuesto** base: plana hasta agotar reservas probadas | editable |

PRIO no es registrante de la SEC: usa CVM + yfinance + su último release citado.
Si un reporte cambia de formato, el patrón no matchea, el dato queda vacío y aparece en *Datos y fuentes → Documentos leídos en EDGAR*.
Probar un trimestre anterior: `python -m pipeline.fetch_edgar --hasta 2026-06-15`.

Regla: un input sin `fuente_url` no entra al modelo. El backtest usa solo datos con `fecha_publicacion` ≤ fecha de observación.

## Puesta en marcha
Pasos detallados para publicarlo en GitHub: **GUIA-GITHUB.md**.
1. Crear repo en GitHub, subir esta carpeta, Settings → Pages → Source: GitHub Actions.
2. Completar `config/parametros.json` y cargar el primer trimestre en `inputs/operativos.csv`.
3. El push dispara la Action; después corre sola cada día hábil.

⚠️ Yahoo Finance no es fuente institucional: sirve para la web en vivo. El TIF cita Bloomberg/FinLab.
