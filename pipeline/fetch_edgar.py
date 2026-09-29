"""Conecta con SEC EDGAR, encuentra el último reporte de resultados de cada empresa, lo lee y extrae
producción, precios realizados y costos por boe según pipeline/recetas.py.
- 10-Q/10-K (EOG, COP): API de submissions → documento principal.
- 6-K (YPF, VIST, PBR): búsqueda de texto completo de EDGAR (efts) → exhibit del release.
Uso: python -m pipeline.fetch_edgar [--hasta AAAA-MM-DD]  (--hasta permite testear trimestres anteriores)"""
import re, sys, json, datetime as dt, urllib.parse
from bs4 import BeautifulSoup
import warnings
from .common import get, guardar, ahora_iso, companias
from .recetas import RECETAS

warnings.filterwarnings("ignore")
ARCH = "https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{doc}"


def _num(s: str) -> float:
    neg = s.startswith("(") and s.endswith(")")
    v = float(s.strip("()").replace(",", ""))
    return -v if neg else v


def texto_plano(url: str) -> str:
    s = BeautifulSoup(get(url, timeout=90).text, "lxml")
    for t in s(["script", "style"]):
        t.decompose()
    return re.sub(r"\s+", " ", s.get_text(" ")).replace("—", "—")


def trimestre_de(txt: str, fecha: str) -> str:
    """Fin de trimestre del reporte: busca '2Q26'/'Q2-26'/'2Q 2026'; si no, el trimestre cerrado antes de la fecha de publicación."""
    m = re.search(r"\b([1-4])Q[ ']?(\d{2}|\d{4})\b|\bQ([1-4])[- ](\d{2}|\d{4})\b", txt[:20000])
    if m:
        q = int(m.group(1) or m.group(3)); y = m.group(2) or m.group(4); y = int(y) + (2000 if len(y) == 2 else 0)
    else:
        f = dt.date.fromisoformat(fecha); q = (f.month - 1) // 3; y = f.year
        if q == 0:
            q, y = 4, y - 1
    fin = {1: "03-31", 2: "06-30", 3: "09-30", 4: "12-31"}[q]
    return f"{y}-{fin}"


def descubrir(cik: int, spec: dict, hasta: str) -> dict:
    if spec["descubrir"] == "submissions":
        r = get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json").json()["filings"]["recent"]
        for i, form in enumerate(r["form"]):
            if form in spec["forms"] and r["filingDate"][i] <= hasta:
                return {"url": ARCH.format(cik=cik, acc=r["accessionNumber"][i].replace("-", ""), doc=r["primaryDocument"][i]),
                        "form": form, "fecha": r["filingDate"][i], "periodo": r["reportDate"][i]}
    else:
        desde = (dt.date.fromisoformat(hasta) - dt.timedelta(days=150)).isoformat()
        hits = []
        for qq in (spec["q"] if isinstance(spec["q"], list) else [spec["q"]]):
            q = urllib.parse.urlencode({"q": qq, "ciks": f"{cik:010d}", "forms": spec["forms"], "startdt": desde, "enddt": hasta})
            hits += get("https://efts.sec.gov/LATEST/search-index?" + q).json()["hits"]["hits"]
        for h in sorted(hits, key=lambda h: h["_source"]["file_date"], reverse=True)[:6]:
            acc, doc = h["_id"].split(":")
            url = ARCH.format(cik=cik, acc=acc.replace("-", ""), doc=doc)
            if spec.get("debe_contener") and spec["debe_contener"].lower() not in texto_plano(url).lower():
                continue
            return {"url": url, "form": spec["forms"], "fecha": h["_source"]["file_date"], "periodo": None}
    return {}


def extraer(emp: str, cik: int, hasta: str) -> dict:
    rec = RECETAS[emp]
    docs, textos = {}, {}
    for clave, spec in rec["docs"].items():
        d = descubrir(cik, spec, hasta)
        if d:
            textos[clave] = texto_plano(d["url"])
            d["periodo"] = d["periodo"] or trimestre_de(textos[clave], d["fecha"])
            d["dias"] = 365 if d["form"] == "10-K" else 91
            docs[clave] = d
    valores, fallas = {}, []
    for campo, (clave, patrones, (lo, hi)) in rec["campos"].items():
        t = textos.get(clave)
        patrones = [patrones] if isinstance(patrones, (str, tuple)) else patrones
        m, factor = None, 1
        for p in patrones:
            pat, factor = (p, 1) if isinstance(p, str) else p
            m = re.search(pat, t) if t else None
            if m:
                break
        if not m:
            fallas.append(f"{campo}: no encontrado"); continue
        v = _num(m.group("v") if "v" in m.groupdict() else m.group(1)) * factor
        if not lo <= v <= hi:
            fallas.append(f"{campo}: {v} fuera de rango {lo}-{hi}"); continue
        valores[campo] = {"valor": v, "doc": clave, "texto": m.group(0)[:160]}
    return {"docs": docs, "valores": valores, "fallas": fallas}


def main(hasta: str | None = None):
    hasta = hasta or dt.date.today().isoformat()
    out = {"actualizado": ahora_iso(), "hasta": hasta, "empresas": {}, "errores": {}}
    for c in companias():
        if c["id"] not in RECETAS:
            continue
        try:
            r = extraer(c["id"], c["sec_cik"], hasta)
            out["empresas"][c["id"]] = r
            per = {k: v["periodo"] for k, v in r["docs"].items()}
            print(f"edgar: {c['id']} {per} → {len(r['valores'])}/{len(RECETAS[c['id']]['campos'])} campos", ("fallas: " + "; ".join(r["fallas"])) if r["fallas"] else "")
        except Exception as e:  # noqa: BLE001
            out["errores"][c["id"]] = str(e); print("edgar:", c["id"], "ERROR", e)
    guardar("edgar.json" if hasta == dt.date.today().isoformat() else f"edgar_{hasta}.json", out)
    return out


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--hasta") + 1] if "--hasta" in sys.argv else None)


# ---------------------------------------------------------------- histórico por período
def _q_fin(q: str) -> dt.date:
    return dt.date.fromisoformat(q)


def descubrir_periodo(cik: int, spec: dict, q_fin: str) -> tuple[dict, str | None]:
    """Documento que informa el trimestre que cierra en q_fin, publicado dentro de los 130 días siguientes."""
    fin = _q_fin(q_fin)
    if spec["descubrir"] == "submissions":
        subs = get(f"https://data.sec.gov/submissions/CIK{cik:010d}.json").json()["filings"]
        tablas = [subs["recent"]] + [get("https://data.sec.gov/submissions/" + f["name"]).json() for f in subs.get("files", [])[:1]]
        for r in tablas:
            for i, form in enumerate(r["form"]):
                if form in spec["forms"] and r["reportDate"][i] == q_fin:
                    d = {"url": ARCH.format(cik=cik, acc=r["accessionNumber"][i].replace("-", ""), doc=r["primaryDocument"][i]),
                         "form": form, "fecha": r["filingDate"][i], "periodo": q_fin, "dias": 365 if form == "10-K" else 91}
                    return d, texto_plano(d["url"])
        return {}, None
    vistos = set()
    for qq in (spec["q"] if isinstance(spec["q"], list) else [spec["q"]]):
        q = urllib.parse.urlencode({"q": qq, "ciks": f"{cik:010d}", "forms": spec["forms"],
                                    "startdt": (fin + dt.timedelta(days=1)).isoformat(), "enddt": (fin + dt.timedelta(days=130)).isoformat()})
        hits = sorted(get("https://efts.sec.gov/LATEST/search-index?" + q).json()["hits"]["hits"], key=lambda h: h["_source"]["file_date"])
        for h in hits[:8]:
            if h["_id"] in vistos:
                continue
            vistos.add(h["_id"])
            acc, doc = h["_id"].split(":")
            url = ARCH.format(cik=cik, acc=acc.replace("-", ""), doc=doc)
            txt = texto_plano(url)
            if spec.get("debe_contener") and spec["debe_contener"].lower() not in txt.lower():
                continue
            if trimestre_de(txt, h["_source"]["file_date"]) == q_fin:
                return {"url": url, "form": spec["forms"], "fecha": h["_source"]["file_date"], "periodo": q_fin, "dias": 91}, txt
    return {}, None


def extraer_periodo(emp: str, cik: int, q_fin: str) -> dict:
    rec = RECETAS[emp]
    docs, textos = {}, {}
    for clave, spec in rec["docs"].items():
        if spec.get("solo_q4") and not q_fin.endswith("12-31"):
            continue
        try:
            d, t = descubrir_periodo(cik, spec, q_fin)
        except Exception as e:  # noqa: BLE001  (EDGAR full-text a veces devuelve 500: se reintenta en la próxima corrida)
            d, t = {}, None
            print(f"   aviso: {emp} {q_fin} {clave}: {e}"[:200])
        if d:
            docs[clave], textos[clave] = d, t
    valores, fallas = {}, []
    for campo, (clave, patrones, (lo, hi)) in rec["campos"].items():
        t = textos.get(clave)
        patrones = [patrones] if isinstance(patrones, (str, tuple)) else patrones
        m, factor = None, 1
        for p in patrones:
            pat, factor = (p, 1) if isinstance(p, str) else p
            m = re.search(pat, t) if t else None
            if m:
                break
        if not m:
            fallas.append(f"{campo}: no encontrado"); continue
        v = _num(m.group("v") if "v" in m.groupdict() else m.group(1)) * factor
        if not lo <= v <= hi:
            fallas.append(f"{campo}: {v} fuera de rango"); continue
        valores[campo] = {"valor": v, "doc": clave, "texto": m.group(0)[:160]}
    return {"docs": docs, "valores": valores, "fallas": fallas}
