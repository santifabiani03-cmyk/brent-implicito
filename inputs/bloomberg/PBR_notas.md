# PBR — notas de carga Bloomberg

- Archivo: `datos bloomberg/INFO PBR US.xlsx` (plantilla Bloomberg; hojas Income Statement, Balance Sheet, Cash Flow, Segments product segment/measure, geographic, Industry).
- Moneda: **USD** (encabezado de las hojas: "Currency USD"; segSettings EQY_FUND_CRNCY = USD). Datos "Adjusted (If Available)": algunos flujos son ajustados de Bloomberg, no GAAP.
- 12 trimestres, 2023-09-30 a 2026-06-30; 417 filas. El agente se cortó por límite de uso después de escribir el CSV y antes de estas notas (las completó el orquestador).
- Operativos: crudo_kbd, gas_kboed, total_kboed y producción Brasil/exterior/presal en 10 trimestres (faltan 2023-09-30 y 2023-12-31; total_kboed en 9).
- ebitda_no_up_mm = refino + gas y energía (12 trimestres). El pipeline **prefiere** el EBITDA ajustado de segmentos del release (EDGAR) y usa este solo si falta.
- Sin acciones en el Excel: la capitalización sigue con acciones ON/PN de la CVM.
- Caja incluye inversiones de corto plazo (deuda − caja = Net Debt de Bloomberg); por eso supera a la de yfinance en 30–60 %.
