# Pedido a la terminal Bloomberg (UADE)

Qué falta bajar para que la web y los resultados coincidan con 6.1, 7.4 y 8.1 del Entregable.
Rango de todo lo diario: **01/04/2024 hasta hoy** (la ventana de la tesis necesita 20 ruedas antes del 01/07/2024). Frecuencia diaria, campo `PX_LAST`.

## 1. Imprescindible

| Dato | Ticker | Para qué | Problema actual |
|---|---|---|---|
| Riesgo país Argentina | ⚠️ a confirmar en la terminal (ver abajo) | WACC diario (7.4, 8.2) | `CT350188 CBIN Curncy` salta entre dos niveles (2.600 → 1.280 → 2.540), trae valores imposibles (9 y 21 pb) y un hueco del 27/06/2025 al 28/11/2025 |
| CO1 | `CO1 Comdty` | Prima (6.1) | `historico c01.xlsx` llegó vacío (una sola celda) |
| CO12 | `CO12 Comdty` | Control de 7.1 y 8.4 | No se bajó nunca |

**Riesgo país Argentina.** Hay que elegir la serie mirando el gráfico en la terminal, antes de exportar:
1. Buscar el CDS soberano de Argentina a 5 años en USD con otra fuente de precio distinta de CBIN, o el genérico análogo al de Brasil (`CBRZ1U5 CBIN Curncy`, que sí está limpio).
2. Si ninguno da una serie continua, usar el spread EMBI de Argentina, y bajar también el de Brasil para que ambos países usen la misma medida.
3. Control antes de exportar: sin saltos de un día a otro del orden del 50 % y sin huecos de semanas.

## 2. Para que la fuente sea la que declara 8.1

| Dato | Ticker | Para qué |
|---|---|---|
| Cotizaciones | `VIST US Equity`, `YPF US Equity`, `EOG US Equity`, `SU US Equity`, `PRIO3 BZ Equity`, `PBR US Equity`, `PBR/A US Equity` | Hoy salen de Yahoo; 8.1 dice Bloomberg |
| Tipo de cambio | `USDBRL Curncy` | Conversión de PRIO (6.1) |
| Índices de mercado | `SPX Index`, `MERVAL Index`, `IBOV Index`, `SPTSX Index` | Control de 8.4: desvíos que coinciden con variaciones amplias del índice local |

⚠️ Confirmar cada ticker en la terminal: estos se anotaron por convención, no se comprobaron ahí.

## 3. Opcional, solo como control del valor de refinación

La refinación ya no usa múltiplos: se valúa por flujos (7.4). Si sobra tiempo, el múltiplo EV/EBITDA de refinadoras puras en cada fecha de la ventana (por ejemplo `VLO US Equity`, `MPC US Equity`, `PSX US Equity`) sirve para contrastar el resultado.

## Formato

Un `.xlsx` por dato, con la fila de encabezado de Bloomberg (Security, Start Date, End Date, Period, Pricing Source) y las columnas Date y PX_LAST. Antes de irse de la terminal, abrir cada archivo y confirmar que tiene filas.
