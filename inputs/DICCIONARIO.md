# Inputs operativos — cómo se cargan

Un renglón por dato. **Nunca** se carga un número sin `fuente_url`. `fecha_publicacion` es la fecha en que el
balance/earnings release se hizo público: el backtest solo usa datos con `fecha_publicacion` ≤ fecha de observación
(evita look-ahead bias, ALCANCE §9).

| variable | unidad | de dónde sale (típico) |
|---|---|---|
| prod_crudo_kbd | miles bbl/día | earnings release / supplement |
| prod_otros_kboed | miles boe/día | gas + NGL (6 Mcf = 1 boe, declarar convención) |
| precio_otros_usd_boe | USD/boe | precio realizado de gas+NGL del trimestre (se fija, no se liga al Brent) |
| diferencial_pct | fracción | 1 − precio realizado crudo / Brent del trimestre (Módulo D) |
| regalias_pct | fracción | notas de EEFF / régimen de concesión |
| retencion_pct | fracción | derechos de exportación efectivos (AR: Dto. 59/2026) |
| lifting_usd_boe | USD/boe | earnings release |
| otros_costos_usd_boe | USD/boe | G&A + transporte + otros cash costs |
| capex_musd_anual | MUSD | guidance anual o capex trimestral ×4 (declarar) |
| dda_usd_boe | USD/boe | DD&A / producción |
| tasa_impuesto | fracción | tasa efectiva o nominal (declarar) |
| reservas_1p_mmboe | MMboe | 10-K / 20-F / informe de reservas |
| crecimiento_anual, anios_crecimiento, declino_anual | fracción / años | guidance + supuesto del equipo |
| deuda_neta_musd | MUSD | automático (SEC/CVM) salvo YPF y VIST |
| minoritarios_musd | MUSD | EEFF |
| valor_no_upstream_musd | MUSD | integradas: downstream por múltiplo (declarar método); pure-plays: 0 |
| acciones_mm | millones | automático (SEC/CVM) salvo YPF y VIST |
| beta | — | beta sectorial desapalancado/reapalancado (MT 7.2.2) |
| kd | fracción | costo de deuda |
| peso_deuda | fracción | D/(D+E) |

`rf`, `erp`, `crp` y `lambda_crp` se cargan una vez en `config/parametros.json`; se pueden pisar por empresa acá.
