"""Producción y reservas de VIST e YPF desde datos abiertos de la Secretaría de Energía (Argentina).
- Producción: 'Producción de Pozos de Gas y Petróleo <año>' (Capítulo IV, mensual por pozo).
- Reservas: 'Reservas al 31/12/<año>' (comprobadas, convencional + no convencional).
⚠️ Ambas series son POR OPERADOR, no por participación: ej. La Amarga Chica (50 % Vista) la opera YPF,
entonces cuenta entera en YPF y nada en Vista. Por eso el valor queda editable y marcado 'operado'."""
import csv, io, zipfile, datetime as dt, calendar
from collections import defaultdict
import requests
from .common import get, guardar, ahora_iso, companias, UA

API = "http://datos.energia.gob.ar/api/3/action/package_show?id={id}"
M3_BBL = 6.2898108            # 1 m3 = 6,2898108 bbl
MM3GAS_BOE = 1e3 * 35.3147 / 6000   # 1 Mm3 de gas → boe (6.000 pies3 = 1 boe)


def _recurso(pkg: str, contiene: str):
    res = get(API.format(id=pkg)).json()["result"]["resources"]
    cand = [r for r in res if contiene in r["name"]]
    return cand[-1]["url"] if cand else None


def produccion(operadores: dict) -> dict:
    anio = dt.date.today().year
    url = _recurso("produccion-de-petroleo-y-gas-por-pozo", f"- {anio} (DDJJ")
    agg = defaultdict(lambda: [0.0, 0.0])   # (id, mes) -> [m3 pet, Mm3 gas]
    with requests.get(url, headers=UA, stream=True, timeout=600) as r:
        r.raise_for_status()
        lineas = (l.decode("utf-8-sig", "replace") for l in r.iter_lines())
        for f in csv.DictReader(lineas):
            emp = f.get("empresa", "").upper()
            for eid, pats in operadores.items():
                if any(p in emp for p in pats):
                    k = (eid, int(f["mes"]))
                    agg[k][0] += float(f["prod_pet"] or 0); agg[k][1] += float(f["prod_gas"] or 0)
    out = {}
    for eid in operadores:
        meses = sorted(m for (e, m) in agg if e == eid)
        # los últimos 2 meses son provisorios en la fuente: se usan los 3 anteriores
        usar = meses[-5:-2] if len(meses) >= 5 else meses[-3:]
        dias = sum(calendar.monthrange(anio, m)[1] for m in usar)
        pet = sum(agg[(eid, m)][0] for m in usar) * M3_BBL / dias / 1000
        gas = sum(agg[(eid, m)][1] for m in usar) * MM3GAS_BOE / dias / 1000
        out[eid] = {"prod_crudo_kbd": pet, "prod_otros_kboed": gas, "meses": [f"{anio}-{m:02d}" for m in usar],
                    "fuente": f"{url} (operado; promedio {anio}-{usar[0]:02d} a {anio}-{usar[-1]:02d})"}
    return out


def reservas(operadores: dict) -> dict:
    import openpyxl
    url = _recurso("reservas-de-petroleo-y-gas", "Reservas al 31/12/")
    anio_url = None
    for y in range(dt.date.today().year, dt.date.today().year - 3, -1):
        u = _recurso("reservas-de-petroleo-y-gas", f"Reservas al 31/12/{y}")
        if u:
            anio_url = u; break
    z = zipfile.ZipFile(io.BytesIO(get(anio_url or url, timeout=120).content))
    wb = openpyxl.load_workbook(io.BytesIO(z.read(z.namelist()[0])), read_only=True, data_only=True)
    ws = wb.worksheets[0]
    tot = defaultdict(float)
    for fila in ws.iter_rows(min_row=8, values_only=True):
        op = str(fila[0] or "").upper()
        for eid, pats in operadores.items():
            if any(p in op for p in pats):
                num = lambda v: float(v) if isinstance(v, (int, float)) else 0.0
                pet_mm3 = num(fila[5]) + num(fila[13])        # comprobadas conv + no conv (Mm3)
                gas_mmm3 = num(fila[6]) + num(fila[14])       # (MMm3)
                tot[eid] += pet_mm3 * 1e3 * M3_BBL / 1e6 + gas_mmm3 * 1e6 * 35.3147 / 6000 / 1e6
    return {eid: {"reservas_1p_mmboe": v, "fuente": f"{anio_url} (comprobadas, operado)"} for eid, v in tot.items()}


def main():
    ops = {c["id"]: c["operador_se"] for c in companias() if c.get("operador_se")}
    out = {"actualizado": ahora_iso(), "produccion": {}, "reservas": {}, "errores": {}}
    for nombre, fn in (("produccion", produccion), ("reservas", reservas)):
        try:
            out[nombre] = fn(ops)
        except Exception as e:  # noqa: BLE001
            out["errores"][nombre] = str(e)
    guardar("ar_se.json", out)
    for e, d in out["produccion"].items():
        print("ar:", e, "crudo", round(d["prod_crudo_kbd"], 1), "kbbl/d; gas", round(d["prod_otros_kboed"], 1), "kboe/d", d["meses"])
    for e, d in out["reservas"].items():
        print("ar:", e, "reservas", round(d["reservas_1p_mmboe"], 1), "MMboe")
    if out["errores"]:
        print("ar errores:", out["errores"])


if __name__ == "__main__":
    main()
