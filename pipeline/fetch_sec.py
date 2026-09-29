"""Fundamentals de SEC EDGAR XBRL (companyfacts) para EOG y ConocoPhillips (10-Q/10-K, us-gaap).
YPF, Vista y Petrobras presentan 20-F anual en IFRS y resultados trimestrales por 6-K sin XBRL:
sus datos trimestrales van por carga manual (inputs/operativos.csv)."""
from .common import get, guardar, ahora_iso, companias

URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
TAGS = {
    "acciones": [("dei", "EntityCommonStockSharesOutstanding", "shares")],
    "deuda_lp": [("us-gaap", "LongTermDebtNoncurrent", "USD"), ("us-gaap", "LongTermDebt", "USD")],
    "deuda_cp": [("us-gaap", "LongTermDebtCurrent", "USD"), ("us-gaap", "DebtCurrent", "USD")],
    "caja": [("us-gaap", "CashAndCashEquivalentsAtCarryingValue", "USD")],
    "inversiones_cp": [("us-gaap", "ShortTermInvestments", "USD")],
    "minoritarios": [("us-gaap", "MinorityInterest", "USD")],
}


def ultimo(facts: dict, candidatos) -> dict | None:
    mejor = None
    for tax, tag, unidad in candidatos:
        for f in facts.get(tax, {}).get(tag, {}).get("units", {}).get(unidad, []):
            if f.get("form") in ("10-Q", "10-K") and (mejor is None or f["end"] > mejor["end"]):
                mejor = {**f, "tag": f"{tax}:{tag}"}
        if mejor:
            return mejor
    return None


def extraer(cik: int) -> dict:
    facts = get(URL.format(cik=cik)).json()["facts"]
    d = {k: ultimo(facts, v) for k, v in TAGS.items()}
    val = lambda k: (d[k]["val"] / 1e6) if d.get(k) else 0.0
    deuda = val("deuda_lp") + val("deuda_cp")
    caja = val("caja") + val("inversiones_cp")
    return {"fecha": (d["caja"] or {}).get("end"), "acciones_mm": val("acciones"),
            "deuda_musd": deuda, "caja_musd": caja, "deuda_neta_musd": deuda - caja,
            "minoritarios_musd": val("minoritarios"),
            "detalle": {k: (v and {"tag": v["tag"], "end": v["end"], "form": v["form"], "accn": v["accn"]}) for k, v in d.items()},
            "fuente": f"SEC EDGAR companyfacts CIK {cik}"}


def main():
    out = {"actualizado": ahora_iso(), "empresas": {}}
    for c in companias():
        if c["fuente_fundamentals"] == "sec_xbrl":
            out["empresas"][c["id"]] = extraer(c["sec_cik"])
            e = out["empresas"][c["id"]]
            print("sec:", c["id"], e["fecha"], round(e["deuda_neta_musd"]), "MUSD deuda neta,", round(e["acciones_mm"], 1), "MM acciones")
    guardar("fund_sec.json", out)


if __name__ == "__main__":
    main()
