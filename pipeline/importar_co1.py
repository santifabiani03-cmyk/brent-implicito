"""Convierte la exportación del CO1 de Bloomberg a inputs/bloomberg/co1.csv. Uso: python -m pipeline.importar_co1 "Precio C01.xlsx"
La hoja no tiene encabezado: día de la semana, fecha y precio, con una fila vacía entre semanas. El día de la semana valida la fecha."""
import csv, datetime as dt, sys
import openpyxl
from .bloomberg import DIR, fecha_co1

DIAS = {"Lu": 0, "Ma": 1, "Mi": 2, "Ju": 3, "Vi": 4}


def main(archivo: str):
    filas = []
    for dia, fecha, precio in openpyxl.load_workbook(archivo, data_only=True, read_only=True).worksheets[0].iter_rows(values_only=True):
        if fecha is None or precio in (None, ""):
            continue
        f = fecha_co1(fecha)
        if dt.date.fromisoformat(f).weekday() != DIAS[dia]:
            raise ValueError(f"{f} no es {dia}: revisar el formato de fecha")
        filas.append((f, float(precio)))
    filas.sort()
    with (DIR / "co1.csv").open("w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["fecha", "co1", "ticker_bloomberg"])
        w.writerows((f, p, "CO1 Comdty") for f, p in filas)
    print(f"co1.csv: {len(filas)} precios, {filas[0][0]} a {filas[-1][0]}")


if __name__ == "__main__":
    main(sys.argv[1])
