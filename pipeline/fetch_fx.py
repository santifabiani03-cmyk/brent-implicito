"""Tipo de cambio USD/BRL oficial (PTAX, Banco Central do Brasil) para convertir la capitalización de PRIO3."""
import datetime as dt
from .common import get, guardar, ahora_iso

URL = ("https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/"
       "CotacaoDolarPeriodo(dataInicial=@i,dataFinalCotacao=@f)")


def ptax(dias: int = 10) -> list:
    f = dt.date.today()
    i = f - dt.timedelta(days=dias)
    p = {"@i": f"'{i:%m-%d-%Y}'", "@f": f"'{f:%m-%d-%Y}'", "$format": "json"}
    return get(URL, params=p).json()["value"]


def main():
    v = ptax()
    ult = v[-1]
    guardar("fx.json", {"actualizado": ahora_iso(), "usd_brl": ult["cotacaoVenda"],
                        "fecha": ult["dataHoraCotacao"], "fuente": "BCB PTAX (venta)"})
    print("fx: USD/BRL", ult["cotacaoVenda"], ult["dataHoraCotacao"])


if __name__ == "__main__":
    main()
