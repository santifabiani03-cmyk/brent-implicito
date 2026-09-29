"""Fundamentals trimestrales de PRIO y Petrobras desde CVM Dados Abertos (ITR, consolidado).
Extrae: deuda financiera (2.01.04 + 2.02.01), caja (1.01.01 + 1.01.02), acciones en circulación.
⚠️ Los valores vienen en BRL miles (MOEDA=REAL, ESCALA=MIL): se convierten a USD con PTAX de la fecha de cierre."""
import csv, io, zipfile, datetime as dt
from collections import defaultdict
from .common import get, guardar, ahora_iso, companias

BASE = "https://dados.cvm.gov.br/dados/CIA_ABERTA/DOC/ITR/DADOS/itr_cia_aberta_{y}.zip"
CUENTAS = {"deuda_cp": "2.01.04", "deuda_lp": "2.02.01", "caja": "1.01.01", "inversiones_cp": "1.01.02"}
PTAX_DIA = ("https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/"
            "CotacaoDolarPeriodo(dataInicial=@i,dataFinalCotacao=@f)")


def _leer(z: zipfile.ZipFile, nombre: str):
    with z.open(nombre) as fh:
        yield from csv.DictReader(io.TextIOWrapper(fh, encoding="latin1"), delimiter=";")


def ptax_en(fecha: str) -> float:
    f = dt.date.fromisoformat(fecha)
    p = {"@i": f"'{f - dt.timedelta(days=7):%m-%d-%Y}'", "@f": f"'{f:%m-%d-%Y}'", "$format": "json"}
    return get(PTAX_DIA, params=p).json()["value"][-1]["cotacaoVenda"]


def extraer(anio: int, codigos: dict) -> dict:
    """codigos: {cd_cvm(int): id_empresa}"""
    z = zipfile.ZipFile(io.BytesIO(get(BASE.format(y=anio), timeout=120).content))
    cds = {f"{c:06d}": e for c, e in codigos.items()}
    vals = defaultdict(dict)   # (empresa, fecha) -> {cuenta: (versao, valor)}
    for arch in (f"itr_cia_aberta_BPA_con_{anio}.csv", f"itr_cia_aberta_BPP_con_{anio}.csv"):
        for r in _leer(z, arch):
            if r["CD_CVM"] in cds and r["ORDEM_EXERC"].startswith("ÚLTIMO"):
                for k, cta in CUENTAS.items():
                    if r["CD_CONTA"] == cta:
                        key = (cds[r["CD_CVM"]], r["DT_REFER"])
                        v = int(r["VERSAO"])
                        if k not in vals[key] or v >= vals[key][k][0]:
                            vals[key][k] = (v, float(r["VL_CONTA"]))
    acciones = {}
    cnpj_a_id = {}
    for r in _leer(z, f"itr_cia_aberta_{anio}.csv"):
        if r.get("CD_CVM", "").zfill(6) in cds:
            cnpj_a_id[r["CNPJ_CIA"]] = cds[r["CD_CVM"].zfill(6)]
    for r in _leer(z, f"itr_cia_aberta_composicao_capital_{anio}.csv"):
        if r["CNPJ_CIA"] in cnpj_a_id:
            tot = float(r["QT_ACAO_TOTAL_CAP_INTEGR"] or 0) - float(r["QT_ACAO_TOTAL_TESOURO"] or 0)
            acciones[(cnpj_a_id[r["CNPJ_CIA"]], r["DT_REFER"])] = {
                "acciones_mm": tot / 1e6,
                "on_mm": (float(r["QT_ACAO_ORDIN_CAP_INTEGR"] or 0) - float(r["QT_ACAO_ORDIN_TESOURO"] or 0)) / 1e6,
                "pn_mm": (float(r["QT_ACAO_PREF_CAP_INTEGR"] or 0) - float(r["QT_ACAO_PREF_TESOURO"] or 0)) / 1e6}
    out = {}
    for (emp, fecha), d in vals.items():
        brl = {k: v[1] / 1000 for k, v in d.items()}           # miles → millones de BRL
        fx = ptax_en(fecha)
        deuda = brl.get("deuda_cp", 0) + brl.get("deuda_lp", 0)
        caja = brl.get("caja", 0) + brl.get("inversiones_cp", 0)
        reg = out.setdefault(emp, {})
        if fecha >= reg.get("fecha", ""):
            reg.update({"fecha": fecha, "ptax_cierre": fx, "deuda_musd": deuda / fx, "caja_musd": caja / fx,
                        "deuda_neta_musd": (deuda - caja) / fx,
                        **acciones.get((emp, fecha), {}),
                        "fuente": f"CVM Dados Abertos ITR {anio} (consolidado), cuentas 2.01.04+2.02.01−1.01.01−1.01.02; PTAX {fecha}"})
    return out


def main():
    cod = {c["cvm_codigo"]: c["id"] for c in companias() if c.get("cvm_codigo")}
    out = {"actualizado": ahora_iso(), "empresas": {}}
    for anio in (dt.date.today().year, dt.date.today().year - 1):
        for emp, d in extraer(anio, cod).items():
            out["empresas"].setdefault(emp, d)
        if len(out["empresas"]) == len(cod):
            break
    guardar("fund_cvm.json", out)
    for e, d in out["empresas"].items():
        print("cvm:", e, d["fecha"], round(d["deuda_neta_musd"]), "MUSD deuda neta,", round(d.get("acciones_mm", 0), 1), "MM acciones")


if __name__ == "__main__":
    main()
