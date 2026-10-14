# EOG - notas de carga Bloomberg

**Fuente:** `datos bloomberg\EOG DATAX.xlsx` (solo lectura). Hojas usadas: IS, BS, CFLOW, MEASURE BY PRODUCT. Cruces: MEASURE BY GEO, RECONCILIATION, SEGMENT BY GEO. Sin uso: SEGMENT BY PROD (duplica MEASURE BY PRODUCT), SBC & AMORTIZATION, Hoja10 (ratios).

**Moneda y unidades:** el libro no declara unidades. Supuesto: millones de USD y acciones en millones. Respaldo: ingresos 2T26 = 8.620 = US 8.482 + extranjero 138 (MEASURE BY GEO). Moneda USD (EOG reporta en USD).

**Trimestres:** 12, de 2023-09-30 a 2026-06-30. Son trimestrales, no YTD: la suma de productos cuadra con el ingreso del trimestre (2T26 y 4T25 exactos).

**Fecha de publicacion:** vacia. El libro no trae "Announcement Date".

**Cargado (162 filas, 15 variables):** las 12 variables de la ESPEC mas 3 extra (ingresos_crudo_mm, ingresos_gas_mm, ingresos_ngl_mm, solo 6 trimestres).

**No cargado (no existe en el Excel):**
- Operativos: crudo_kbd, ngl_kbd, gas_mmcfd, total_kboed, p_crudo, p_ngl, p_gas, lifting_boe, dda_boe, reservas_mmboe. Ninguna hoja trae volumenes, precios realizados ni reservas.
- minoritarios_mm (Minority Interest vacio), toti_mm, regalias_mm, retenciones_mm (no aplican a EOG en el libro), ebitda_no_up_mm (pure-play).

**Dudas:**
1. Valores de control: 548,8 kbd, 346,8 kbd, 3.089 MMcfd y 98,15 USD/bbl no aparecen en ninguna hoja (busqueda numerica en todo el libro). Chequeo indirecto: 548,8 kbd x 91 dias x 98,15 USD = 4.901,7 MMUSD, que coincide con el crudo 2T26 de 4.901 en MEASURE BY PRODUCT. Confirma la columna, pero no reemplaza los volumenes. Hace falta otra exportacion o el 10-Q.
2. opex_mm = Cost of Goods & Services (1.574 en 2T26). Incluye compras y comercializacion, no solo lease & well. Sobreestima el opex upstream frente a la definicion de la ESPEC.
3. sga_mm = G&A (213). El SG&A total de Bloomberg (2.163) incluye Selling & Marketing (1.950), que es costo de GP&M, por eso no se usa.
4. deuda_mm = ST Debt + LT Debt. Las sub-lineas no suman (2T26: ST Debt 675 vs componentes visibles 27 + 324). El total cuadra con Net Debt de BS en los 12 trimestres.
5. FQ1 2026: crudo + GP&M + gas + NGL + ajuste + otros = 6.755, contra Revenue de IS 6.724 (dif. 31). Los demas trimestres con detalle cuadran exacto.
6. ebitda_mm = EBITDA ajustado de IS (= RECONCILIATION). CFLOW trae otro EBITDA (4.787 en 2T26) que no use. resultado_antes_imp_mm es GAAP, no el ajustado.
7. capex_mm = Acq of Fixed & Intang, bruto, signo invertido. No descuenta disposiciones (Change in Fixed & Intang es neto).
8. Ingresos por producto solo existen en 6 trimestres (faltan 3T25 a 2T24). No interpole.

**Valores de control (variable | periodo | valor):**
- ingresos_mm | 2026-06-30 | 8620
- ebitda_mm | 2026-03-31 | 3594
- caja_mm | 2025-12-31 | 3396
