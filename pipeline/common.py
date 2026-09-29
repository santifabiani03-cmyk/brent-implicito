import json, time, pathlib, datetime as dt
import requests

RAIZ = pathlib.Path(__file__).resolve().parents[1]
DATA = RAIZ / "data"
DATA.mkdir(exist_ok=True)
# La SEC exige un User-Agent identificable (https://www.sec.gov/os/accessing-edgar-data)
UA = {"User-Agent": "TIF-UADE-Finanzas brent-implicito (contacto: smfabiani11@gmail.com)"}


def get(url: str, params=None, intentos: int = 3, timeout: int = 30, **kw) -> requests.Response:
    ultimo = None
    for n in range(intentos):
        try:
            r = requests.get(url, params=params, headers=kw.pop("headers", UA), timeout=timeout)
            r.raise_for_status()
            return r
        except Exception as e:  # noqa: BLE001
            ultimo = e
            time.sleep(2 ** n)
    raise RuntimeError(f"GET falló: {url} → {ultimo}")


def ahora_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def guardar(nombre: str, obj) -> None:
    (DATA / nombre).write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")


def cargar(nombre: str, defecto=None):
    p = DATA / nombre
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else defecto


def companias() -> list[dict]:
    return json.loads((RAIZ / "config" / "companies.json").read_text(encoding="utf-8"))["empresas"]
