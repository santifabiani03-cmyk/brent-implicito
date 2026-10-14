# Carga de datos Bloomberg — especificación común (agentes)

Contexto: TIF Finanzas UADE. La web `brent-implicito` despeja el Brent implícito en la capitalización
de 6 petroleras (VIST, YPF, EOG, SU=Suncor, PRIO, PBR) con un DCF sobre reservas, calibrado con el último
balance publicado. Hoy los datos salen de EDGAR/yfinance; ahora la fuente principal son los Excel de la
terminal Bloomberg en `C:\Users\smfab\Desktop\TIF\datos bloomberg\`.

## Tu tarea
Leer SOLO el Excel de tu empresa (solo lectura: nunca lo modifiques ni lo guardes) y escribir:
1. `C:\Users\smfab\Desktop\TIF\bi\inputs\bloomberg\<ID>.csv`
2. `C:\Users\smfab\Desktop\TIF\bi\inputs\bloomberg\<ID>_notas.md` (máx. 40 líneas)

No toques ningún otro archivo. Scripts temporales: en tu scratchpad, nunca dentro de `datos bloomberg`.
Leé con `python -I` + openpyxl (`load_workbook(f, read_only=True, data_only=True)`). Volcá primero las
etiquetas de filas (columna A/B) y los encabezados de período para ubicar los campos; no vuelques hojas enteras.

## Formato del CSV (UTF-8, coma, punto decimal, encabezado exacto)
```
empresa,periodo,fecha_publicacion,variable,valor,unidad,moneda,hoja,campo_bloomberg,nota
```
- `periodo`: fin del trimestre fiscal `YYYY-MM-DD` (ej. 2026-06-30). Para datos anuales (reservas) el cierre del ejercicio.
- `fecha_publicacion`: fecha de anuncio del balance si el Excel la trae (fila tipo "Announcement Date"); si no, vacío.
- Trimestres: todos los disponibles desde 2023-09-30 hasta el último. Valores DEL TRIMESTRE (no acumulados YTD,
  no TTM). Si el Excel solo trae anual o semestral, informalo en `nota` y en las notas; no inventes trimestres.
- `valor`: número tal como sale en el Excel convertido a la unidad indicada (millones → `musd`, etc.).
- `moneda`: la del dato en el Excel (USD, BRL, ARS, CAD). NO conviertas de moneda: lo hace el pipeline.
  Si el Excel dice "in millions of X", usá X. Unidades físicas: moneda vacía.
- `campo_bloomberg`: etiqueta exacta de la fila (y mnemónico si aparece). `hoja`: nombre de la hoja.
- Si un campo no existe en el Excel, NO lo pongas (nada de ceros de relleno ni estimaciones).

## Variables (usá exactamente estos nombres; las que no apliquen, omitilas)
Estados contables (flujos del trimestre, en millones de la moneda del Excel):
| variable | qué es |
|---|---|
| ingresos_mm | Revenue / ventas totales |
| dda_mm | Depreciación, agotamiento y amortización |
| sga_mm | Gastos de administración (SG&A o G&A) |
| opex_mm | Costos de producción / operativos del upstream (lease operating, production costs) |
| toti_mm | Impuestos distintos de ganancias / production taxes (US) |
| regalias_mm | Regalías (si aparecen separadas) |
| retenciones_mm | Derechos de exportación (AR) |
| capex_mm | Capex del trimestre (valor positivo) |
| intereses_mm | Gasto por intereses (positivo) |
| impuesto_ganancias_mm | Impuesto a las ganancias del trimestre |
| resultado_antes_imp_mm | Resultado antes de impuestos |
| ebitda_mm | EBITDA (si Bloomberg lo calcula) |
| ebitda_no_up_mm | Solo integradas: EBITDA (o resultado operativo + DD&A) de los segmentos NO upstream (refinación, downstream, gas & energía, etc.). Detallá en nota qué segmentos sumaste |
Stocks al cierre del trimestre (millones):
| deuda_mm | Deuda financiera total (corto + largo; indicá si incluye leasing) |
| caja_mm | Caja y equivalentes (indicá si sumaste inversiones de corto plazo, en nota) |
| minoritarios_mm | Interés minoritario / participaciones no controladoras |
| acciones_mm | Acciones en circulación (millones; unidad "mm acciones", moneda vacía). Si hay clases (PBR ON/PN) cargá también acciones_on_mm y acciones_pn_mm |
Operativos (del trimestre):
| crudo_kbd | Producción de crudo + condensado, miles bbl/día (Suncor: incluí SCO/bitumen en `bitumen_kbd` aparte) |
| bitumen_kbd | Suncor: bitumen/SCO, miles bbl/día |
| ngl_kbd | NGL, miles bbl/día |
| gas_mmcfd | Gas, millones de pies cúbicos/día (si viene en m3/día u otra unidad, convertí y explicá en nota) |
| total_kboed | Producción total, miles boe/día |
| p_crudo | Precio realizado del crudo, USD/bbl |
| p_ngl | Precio realizado NGL, USD/bbl |
| p_gas_mcf / p_gas_mmbtu | Precio realizado gas (según unidad que traiga) |
| lifting_boe | Lifting cost USD/boe |
| dda_boe | DD&A por boe |
| reservas_mmboe | Reservas probadas (1P) al cierre del ejercicio, MMboe (anual) |
| reservas_crudo_mmbbl | Reservas probadas de crudo, si vienen separadas |

Si encontrás otro dato claramente útil para el modelo que no está en la lista (p. ej. precio realizado en BRL,
producción por país), agregalo con un nombre descriptivo en snake_case y explicalo en las notas.

## Notas (<ID>_notas.md)
Qué hojas usaste, moneda y unidades, qué trimestres hay, qué faltó, dudas (p. ej. si un valor parece acumulado YTD),
y 3 valores de control (variable, período, valor) para que el verificador los compare contra el Excel.

## Respuesta final al orquestador
Máximo 12 líneas: ruta de los 2 archivos, cantidad de filas, rango de trimestres, variables cargadas, faltantes y dudas.
