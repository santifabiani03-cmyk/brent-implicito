# Pedido a la terminal Bloomberg (UADE)

Qué falta bajar para que la web y los resultados coincidan con 6.1, 7.4 y 8.1 del Entregable.
Rango de todo lo diario: **01/04/2024 hasta hoy** (la ventana de la tesis necesita 20 ruedas antes del 01/07/2024).

Ya recibido y validado (04/11/2026): `CO1 Comdty` (cargado en `co1.csv`), CDS de Brasil `CBRZ1U5 CBIN Curncy` y `CRP` de EE. UU. en USD.

## 1. Para reemplazar el EMBI público: riesgo país de Argentina y Brasil

La web ya usa riesgo país diario: EMBI de ArgentinaDatos para Argentina y CDS de Bloomberg para Brasil. Esto hace falta solo para que Argentina también salga de la terminal (8.1) o para usar la misma medida en los dos países.

La exportación de `CT350188 CBIN Curncy` volvió igual: salta entre dos niveles (2.598 → 1.278 → 2.542), trae valores imposibles (9 y 21 pb) y tiene un hueco del 27/06/2025 al 28/11/2025. **No volver a bajar ese ticker.**

**Opción A: función `CRP`, para despejar.** Bajar para **Argentina y Brasil**, en **USD** y diario, lo mismo que ya se bajó de EE. UU. (columnas Fecha, Rnd div, Tasa crec, Ratio pago div, Ret merc, Tasa LR, Prima).
- Riesgo país = Prima del país − Prima de EE. UU.
- Antes de exportar, confirmar que esté en USD. Si queda en moneda local, la tasa y el retorno incorporan inflación y devaluación, y la resta no da riesgo país.
- Esta medida es una prima de acciones, no el diferencial soberano que nombran 7.4 y 8.2. Si se usa, hay que ajustar el texto.

**Opción B: diferencial soberano, como dice el texto.** Spread EMBI de Argentina y de Brasil, o un CDS soberano de Argentina a 5 años con otra fuente de precio. ⚠️ El ticker hay que buscarlo en la terminal.

Control antes de exportar, para cualquiera de las dos: mirar el gráfico. Sin saltos de un día a otro del orden del 50 % y sin huecos de semanas.

## 2. Para que la fuente sea la que declara 8.1

| Dato | Ticker | Para qué |
|---|---|---|
| CO12 | `CO12 Comdty` | Control de 7.1 y 8.4 |
| Cotizaciones | `VIST US Equity`, `YPF US Equity`, `EOG US Equity`, `SU US Equity`, `PRIO3 BZ Equity`, `PBR US Equity`, `PBR/A US Equity` | Hoy salen de Yahoo; 8.1 dice Bloomberg |
| Tipo de cambio | `USDBRL Curncy` | Conversión de PRIO (6.1) |
| Índices de mercado | `SPX Index`, `MERVAL Index`, `IBOV Index`, `SPTSX Index` | Control de 8.4: desvíos que coinciden con variaciones amplias del índice local |

⚠️ Confirmar cada ticker en la terminal: estos se anotaron por convención, no se comprobaron ahí.

## 3. Opcional, solo como control del valor de refinación

La refinación ya no usa múltiplos: se valúa por flujos (7.4). Si sobra tiempo, el múltiplo EV/EBITDA de refinadoras puras en cada fecha de la ventana (por ejemplo `VLO US Equity`, `MPC US Equity`, `PSX US Equity`) sirve para contrastar el resultado.

## Formato

Un `.xlsx` por dato, con la fila de encabezado de Bloomberg (Security, Start Date, End Date, Period, Pricing Source) y las columnas Date y PX_LAST. Antes de irse de la terminal, abrir cada archivo y confirmar que tiene filas y fechas en un solo formato.
