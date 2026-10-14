# SU (Suncor Energy) - notas de carga Bloomberg

**Fuente**: `Suncor Estados Contables.xlsx` (solo lectura). Hojas usadas: Income Statement, Balance Sheet, Cash Flow, Segments (solo filas 1-73), Reconciliation (solo verificada).
**Moneda/unidad**: CAD, millones (`unidad=mcad`, `moneda=CAD`). Verificada: neto 2023Q3 = 1.151 y 2023Q4 = 2.072 coinciden con lo reportado por Suncor en CAD. No se convirtio nada; el pipeline debe pasar CAD->USD.
**Trimestres**: 12, de 2023-09-30 a 2026-06-30 (todos trimestrales, valores del trimestre, no YTD ni TTM). `fecha_publicacion` vacia (el Excel no trae Announcement Date).
**Filas CSV**: 643 (60 variables).

## ALERTA: la hoja Segments mezcla otra empresa
Las filas 76-519 de `Segments` son de Freeport-McMoRan (Indonesia/Grasberg, Cerro Verde, Morenci, toneladas de cobre). NO se uso nada de ahi. Solo el primer bloque (filas 3-73: R&M, Oil Sands, E&P, Corporate, Fort Hills/Syncrude/In Situ) es Suncor. Conviene que quien arme el Excel lo regenere si quiere produccion.

## Mapeo (variables del ESPEC)
- ingresos_mm = Revenue (fila 3; 2026Q1 trae -686 de Other Revenue por derivados; `ingresos_ventas_servicios_mm` es antes de eso). Neto de regalias (no hay linea de regalias: `regalias_mm` no existe).
- sga_mm = "Selling, General & Admin" de Bloomberg, que en Suncor es Operating, Selling & General (incluye costos operativos), NO G&A puro. Los 4 segmentos suman exactamente este valor.
- opex_mm = Oil Sands + E&P (campo "SG&A" de esos segmentos). Es SUBCONJUNTO de sga_mm: no sumar ambos. Incluye algo de G&A.
- dda_mm, intereses_mm, impuesto_ganancias_mm (GAAP), resultado_antes_imp_mm (GAAP), ebitda_mm (AJUSTADO, IS fila 49), capex_mm (Acq of Fixed & Intang, bruto, positivo), deuda_mm, caja_mm.
- deuda_mm = ST Debt + LT Debt, INCLUYE leasing (`arrendamientos_total_mm` = parte leasing, ~3.400 en 2026Q2). Verificado: deuda - caja = Net Debt de Bloomberg (+-1 por redondeo).
- caja_mm = Cash & Equivalents (ST Investments = "-").
- ebitda_no_up_mm = solo Refining & Marketing = Pretax Income + D&A del segmento. DISPONIBLE SOLO en 3 trimestres (2024-09-30, 2026-03-31, 2026-06-30): Bloomberg no llena esos campos en los demas. Corporate & Elimination se EXCLUYE (lleva intereses, FX y eliminaciones intersegmento; no es negocio operativo). Oil Sands y E&P = upstream.
- Para el resto de trimestres hay referencias del segmento R&M en todos los periodos: `resultado_ajustado_seg_refinacion_mm` (semantica ambigua, cercano a pretax ajustado), `ventas_ajustadas_seg_refinacion_mm`, `capex_seg_refinacion_mm`.
- Extras utiles: ebitda_gaap_mm, resultado_operativo_ajustado_mm, resultado_neto(_ajustado)_mm, cfo_mm, dividendos_pagados_mm, recompras_mm, patrimonio_total_mm, capex por segmento y por activo (Fort Hills, Syncrude, In Situ; 2025Q4 vacio en Bloomberg), `*_seg_*` (pretax/D&A por segmento, 3 trimestres; los 4 pretax suman el GAAP consolidado).

## NO disponible en el Excel (no inventado)
Produccion (`bitumen_kbd`, `crudo_kbd`, `ngl_kbd`, `gas_mmcfd`, `total_kboed`), precios realizados (`p_crudo_cad`, etc.), lifting, dda_boe, reservas, **acciones_mm** (no hay shares ni EPS), minoritarios (celda "-": Suncor no tiene NCI; omitido en vez de poner 0), toti_mm, regalias_mm, retenciones_mm. La hoja Industry dice "No Data Available". Hay que sacarlos de otra fuente (MD&A/Operating Statistics de Suncor).

## Dudas
- "Adjusted Net Income" por segmento no suma el neto ajustado consolidado; usar solo como referencia.
- `ventas_ajustadas_seg_*` no concilia con Revenue consolidado.
- ebitda_mm (ajustado) difiere de ebitda_gaap_mm en trimestres con items anormales (ej. 2023Q4: 2.648 vs 3.363).

## Valores de control (para el verificador)
1. ingresos_mm, 2026-06-30 = 13735 (Income Statement fila "Revenue")
2. deuda_mm, 2026-06-30 = 10332 (Balance Sheet: ST Debt 972 + LT Debt 9360)
3. ebitda_no_up_mm, 2026-06-30 = 1716.1 (Segments: R&M Pretax 1517.39 + D&A 198.71)

## Corrección (orquestador, 2026-10-14)
El Excel de Bloomberg de Suncor está en **USD**, no en CAD: el resultado neto 4T24 (585), 1T25 (1.177) y 2T25 (819)
coincide con lo publicado por Suncor en CAD (818, 1.688, 1.133) × tipo de cambio CAD→USD del trimestre, y el
resultado antes de impuestos y D&A de R&M (nota de segmentos de los filings, en `SU_operativos.csv`) es el del
Excel / 0,72 en los 3 trimestres comparables. Se corrigió `moneda` a USD en todas las filas de `SU.csv`.
