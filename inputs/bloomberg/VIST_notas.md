# VIST (Vista Energy) - notas de carga Bloomberg

Fuente: `datos bloomberg\INFO VIST.xlsm` (solo lectura, openpyxl data_only). Salida: `VIST.csv` (503 filas, 42 variables).

## Hojas y unidades
- Usadas: `Income Statement`, `Balance Sheet`, `Cash Flow`, `segments`. Todo en millones de USD (celda Currency = USD), periodicidad Quarterly.
- 12 trimestres: 2023-09-30 a 2026-06-30. Trimestres discretos (no YTD, no TTM): NI del CF = NI del IS en cada trimestre.
- Las hojas IS, BS, CF, RC, SA, AD, SG, SG2, SegData, Data Check, Custom, RA, Help son plantillas/contadores sin datos de VIST.
- `Industry`: dice "No Data Available" (sin producción, precios realizados, lifting, reservas). `Reconciliation` y `Ratios` solo repiten datos.

## Faltantes (no existen en el Excel, no se inventaron)
- Operativos: crudo_kbd, ngl_kbd, gas_mmcfd, total_kboed, p_crudo, p_ngl, p_gas, lifting_boe, dda_boe, reservas_mmboe. Hay que sacarlos de otra fuente.
- acciones_mm: el Excel no trae acciones en circulación (la BS solo tiene capital en USD). Pendiente de otra fuente.
- fecha_publicacion: sin fila "Announcement Date"; vacía en todas las filas.
- toti_mm, regalias_mm: no separados (van dentro de costo de ventas). ebitda_no_up_mm: no aplica.
- retenciones_mm: solo 2023-09-30 a 2026-03-31 (11 trim.); falta 2026-06-30 (el desglose de ingresos de Q2-26 cierra sin ese ítem).

## Decisiones de mapeo (revisar)
- opex_mm = "Cost of Goods & Services" SIN D&A (IS_COG&SS_GAAP). NO es lifting puro: agrupa producción, regalías, compras y otros. Proxy.
- dda_mm = IS_D&A_COR_GAAP (D&A dentro del costo de ventas; igual a CF_DEPR_AMORT).
- sga_mm = SG&A total (Selling + G&A). Selling (selling_mm) probablemente incluye fletes y quizá retenciones; G&A suelto en ga_mm.
- ebitda_mm = EBITDA de IS (Oper. Inc. + D&A). Cierra exacto con ingresos - opex - sga + otros_ingresos_op - otros_gastos_op. Ojo: otros_ingresos_op fue 208 (2025Q2) y 290 (2025Q3), y otros_gastos_op 150.7 (2026Q1): el EBITDA de esos trimestres está distorsionado por partidas no recurrentes.
- Retenciones: ingresos_mm es bruto de retenciones (segmento Petroleo = export + mercado interno + retenciones + ajuste de reconciliación). El costo asociado no está identificable en el Excel: no restarlo dos veces.
- deuda_mm = BS_ST_BORROW + BS_LT_BORROW (incluye arrendamientos). Cierra exacto con NET_DEBT Bloomberg (deuda - caja) en los 12 trimestres. `*_ex_arrend_mm` (SHORT_TERM_DEBT_DETAILED, LONG_TERM_BORROWINGS_DETAILED) es un supuesto: la diferencia sería leasing.
- caja_mm = C&CE_AND_STI (efectivo + inversiones cp; inversiones_cp_mm es 22.8 en 2026Q1 y 5.6 en 2025Q4, 0 el resto).
- capex_mm = Acq of Fixed & Intang (PP&E + intangibles, signo invertido a positivo). capex_ppe_mm = solo PP&E.
- minoritarios_mm: 0 hasta 2026-03-31 y 189.99 en 2026-06-30 (nuevo: hubo adquisición de subsidiaria por 586.7 musd en 2026Q2; ver adquisiciones_*). Estructura de capital cambia en 2025Q2 (841.6) y 2026Q2.
- Extras (snake_case): ga_mm, selling_mm, otros_ingresos_op_mm, otros_gastos_op_mm, resultado_operativo_mm, resultado_neto_mm, resultado_minoritarios_mm, deuda_cp_mm/lp_mm, patrimonio_total_mm, activos_totales_mm, ppe_neto_mm, deuda_neta_bbg_mm, capex_ppe_mm, cfo_mm, adquisiciones_mm, adquisiciones_subsidiarias_mm, impuestos_pagados_mm, intereses_pagados_mm, ingresos por segmento (petroleo_segmento, crudo_export, crudo_mi, gas, gas_export, gas_mi, glp; suman el ingreso total exacto).

## Valores de control (variable, período, valor musd)
1. ingresos_mm, 2026-06-30 = 1234.902 (Income Statement, fila SALES_REV_TURN)
2. deuda_mm, 2026-06-30 = 3754.569 (= 731.918 + 3022.651; caja_mm 604.657; NET_DEBT BBG 3149.912)
3. capex_mm, 2026-06-30 = 502.433 (Cash Flow, ACQUIS_FXD_&_INTANG_DETAILED = -502.433)
