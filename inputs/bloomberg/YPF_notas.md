# YPF - notas de carga Bloomberg (YPFD DATAX.xlsx)

**Hojas usadas:** IS, bs, CFlow, SEGMENT BY PROD (y reconciliation solo para chequeos). `MEASURE BY PROD` repite SEGMENT; `ratios` y `sbc & amortization` no se cargaron.
**Trimestres:** 12, de 2023-09-30 a 2026-06-30. Valores trimestrales (no YTD ni TTM): los 4 trimestres de 2024 suman 19.299 = ingresos del año; Net Income de CFlow = IS.
**fecha_publicacion:** vacía; el Excel no trae fila de Announcement Date.

## Moneda (identificada, no hay etiqueta en el Excel)
- IS, bs, CFlow y segmentos estan en **USD millones** (moneda funcional/de reporte de YPF), no en ARS pese al ticker YPFD.
- Evidencia: ingresos 4,3-6,6 mil mm por trimestre, caja 1,3 mil mm, deuda neta 8,4 mil mm (escala USD; en ARS serian billones).
- Contraprueba: la hoja `sbc & amortization` si esta en ARS (EPS ajustado 424,52 en 2Q26). EPS x 3933 mm / NI ajustado IS da un tipo de cambio implicito de ~897 (2Q24), ~945 (3Q24), ~1.277 (3Q25) y ~1.421 ARS/USD (2Q26), coherente con el oficial. Todo se cargó con moneda=USD; no hay valores en ARS en el CSV.

## ADVERTENCIA acciones (10x)
- "Shares Outstanding" = 3933 y "Basic Weighted Avg Shares" = 3933 NO son acciones: es el capital social en ARS mm (VN ARS 10 por accion; coincide con Common Stock 3.917-3.922 de bs). Acciones reales de YPF: 393,3 mm (393.312.793).
- `acciones_mm` = 393,3 (= Excel/10) y se agrego `acciones_excel_bruto_mm` = 3933 solo por trazabilidad. Usar acciones_mm. Constante en los 12 trimestres (el Excel no refleja recompras: promedio ponderado 3879 en 4Q25).

## ebitda_no_up_mm (integrada)
- Suma de Operating Income + Depreciation and Amortization de los segmentos NO upstream que reporta cada trimestre, excluyendo `Central Administration & Others` y `Reconciliation` (se publican aparte en `resultado_operativo_corp_ajustes_mm`).
- 2Q26, 3Q25, 1Q25: Midstream and Downstream + LNG and Integrated Gas + New Energies. 3Q24: ídem (LNG sin D&A en el Excel: se uso su fila Depreciation=1). 2Q24 y 1Q24: estructura vieja Downstream + Gas & Power.
- Los OI por segmento suman exactamente el EBIT GAAP de reconciliation (control hecho en todos los trimestres con datos).
- Solo se cargó en 6 trimestres (2024-03, 2024-06, 2024-09, 2025-03, 2025-09, 2026-06): en el resto Bloomberg no trae la fila "Depreciation and Amortization" por segmento. La fila "Depreciation" no sirve de reemplazo (no cuadra con el D&A consolidado: ej. M&D 3Q25 84 vs 185).
- En los demas trimestres se cargo `resultado_operativo_no_up_mm` (sin D&A) y se dejo ebitda_no_up vacío; no se estimó.
- OI de segmento es GAAP: incluye write-downs (3Q23 aprox. 574; 4Q25 New Energies 346 parece ganancia extraordinaria).

## Faltantes (no existen en el Excel, no cargados)
opex_mm (upstream), toti_mm, regalias_mm, retenciones_mm, todo lo operativo (crudo, gas, NGL, total_kboed, precios realizados, lifting, dda_boe), reservas. Solo hay exportaciones de refinados/quimicos (no cargadas). `costo_bienes_servicios_mm` es costo total (con compras), NO es lifting.

## Otras decisiones y dudas
- deuda_mm = ST Debt + LT Debt (incluye leasing, ~0,7 mil mm); `deuda_bancaria_mm` = solo borrowings. caja_mm incluye ST Investments (coincide con Net Debt de Bloomberg); `caja_solo_mm` sin ellas. Diferencia grande en 2Q26: 1.156 de inversiones.
- ebitda_mm = EBITDA ajustado de IS (EBIT aj. + D&A); CFlow trae otro EBITDA (ej. 2Q26 2.692 vs 2.717), no cargado.
- capex_mm = Change in Fixed & Intang con signo invertido. dda_mm = D&A de CFlow (878 en 2Q26 = reconciliation).
- 2023 (3Q y 4Q) sospechoso: 4Q23 trae pretax GAAP -2.480, abnormal 3.342, PP&E bruto 76.684 (vs ~54.000 en 2024) y capital de 5 (USD) frente a 3.900+ desde 1Q24; los segmentos 2023 tienen Assets en ARS (4.289.435). Usar 2023 con cautela.
- Estructura de segmentos cambia (2023: Commercialization/Industrialization/G&P; 2Q24-1Q24 y 4Q24: Downstream/G&P; luego M&D/LNG/New Energies), asi que ebitda_no_up no es 100% comparable en el tiempo. Faltan por completo los segmentos de 1Q26 y 2Q25.
- Extras cargados: resultado_operativo_mm (EBIT aj.), resultado_neto_mm, flujo_operativo_mm, patrimonio_neto_mm (antes de minoritarios), inversiones_afiliadas_mm, deuda_neta_mm, resultado_operativo_{upstream,no_up,corp_ajustes}_mm, dda_{upstream,no_up}_mm.

## Valores de control (verificar contra el Excel)
| variable | período | valor | celda |
|---|---|---|---|
| ingresos_mm | 2026-06-30 | 6577 | IS!H3 |
| deuda_mm | 2026-06-30 | 10844 | bs!H45 (1911) + bs!H52 (8933) |
| ebitda_no_up_mm | 2026-06-30 | 921 | SEGMENT: OI 707-35+27=699 + D&A 182+33+7=222 |
