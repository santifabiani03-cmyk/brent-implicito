# PRIO (PRIO3 BZ) - notas de carga Bloomberg
Fuente: `datos bloomberg\INFO PRIO3.xlsx` (solo lectura). CSV: `PRIO.csv` (341 filas de datos).

## Hojas usadas y moneda
- `Income Statement`, `Balance Sheet`, `Cash Flow` (plantilla Industrial, trimestral, 12 trimestres) y `Segments` (ingreso por campo).
- Moneda: **USD** (cabecera "Currency USD" en cada hoja y `EQY_FUND_CRNCY=USD` en `segSettings`). PRIO reporta en BRL; Bloomberg ya
  lo convirtio a USD (flujos y stocks a su tipo de cambio). Por eso `moneda=USD` y el pipeline no debe volver a convertir.
- Unidades: millones de USD (`musd`). Trimestres discretos (no YTD ni TTM): 2023-09-30 ... 2026-06-30 = 12 trimestres.
- `fecha_publicacion` vacia: el Excel no trae fila "Announcement Date".

## Variables cargadas
ingresos_mm, dda_mm (CF), sga_mm (solo G&A), opex_mm (ver dudas), capex_mm, intereses_mm, impuesto_ganancias_mm,
resultado_antes_imp_mm (GAAP), ebitda_mm, deuda_mm (ST+LT debt), caja_mm, minoritarios_mm (0 en todos).
Extras: resultado_operativo_mm, resultado_neto_mm, ingresos_intereses_mm, cfo_mm, recompra_acciones_mm (positivo),
deuda_cp_mm, deuda_lp_mm, prestamos_cp_mm, prestamos_lp_mm (sub-items "Borrowings", pueden excluir leasing), patrimonio_mm,
activos_totales_mm, deuda_neta_bbg_mm, ingresos_campo_<peregrino|frade|abl|polvo_tbmt|trading|wahoo|manati>_mm.
Los ingresos por campo suman el total de ingresos_mm en los 12 trimestres (dif. max. 0.1) - control cruzado OK.

## Lo que NO esta en el Excel (no se invento nada)
- Produccion (crudo/gas/total boe), precios realizados, lifting cost, DD&A por boe, reservas: la hoja `Industry` dice
  "No Data Available" y no hay otra hoja con operativos. Para el modelo hay que usar los reportes de PRIO (RI) como fuente.
- Acciones en circulacion (`acciones_mm`): sin fila de shares ni EPS en el Excel (secciones EPS vacias).
- regalias_mm, toti_mm, retenciones_mm, ebitda_no_up_mm: no aplican / no separados.

## Dudas y advertencias
- opex_mm = "Cost of Goods & Services" SIN D&A: mezcla costos de produccion con regalias/otros; no es lifting puro. Muy volatil
  (4T24: 136 vs 3T24: 284), probable artefacto de Bloomberg al derivar trimestres.
- capex_mm = "Acq of Fixed & Intang". Picos en 4T24 (1,909) y 4T25 (1,962): casi seguro compras de campos (Peregrino, que aparece
  en ingresos desde 1T25), no capex organico. Capex organico ronda 130-620 por trimestre. No lo pude confirmar con el Excel.
- CF trimestral derivado y ruidoso (cfo 3T25 = -1,189 por diferencias de YTD convertidas a USD); FX effect grande.
- sga_mm 4T24 viene en 0 en el Excel (artefacto) y se omitio; ingresos_intereses_mm 1T25 = 0 tambien se omitio.
- ebitda_mm toma la fila de `Income Statement` (EBIT ajustado + D&A CF). `Cash Flow` trae otra fila EBITDA (EBIT GAAP) un poco menor
  (2T26: 853.9 vs 855.4). Impuesto: positivo=gasto; 4T24 = -963 (beneficio por activacion de diferidos).
- deuda_mm = ST Debt + LT Debt de Bloomberg (coincide con su Net Debt + caja); no se puede asegurar si incluye leasing al 100%.
- minoritarios_mm: Bloomberg informa 0 (aunque Total Equity difiere ~0.3 de "Equity Before Minority Interest").

## Valores de control (para el verificador)
1. ingresos_mm, 2026-06-30 = 1389.982504 (Income Statement, fila 13 "Revenue", col L).
2. deuda_mm, 2026-06-30 = 4927.027613 (Balance Sheet, filas 49 "ST Debt" 921.4851195 + 58 "LT Debt" 4005.542493, col L).
3. ebitda_mm, 2025-12-31 = 356.746568 (Income Statement, fila 60 "EBITDA", col N).
