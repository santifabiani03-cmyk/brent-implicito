#!/bin/bash
cd "$(dirname "$0")"
echo "Actualizando datos de Barril Implicito (tarda 2-5 minutos)..."
python3 -m pip install -q -r requirements.txt
python3 -m pipeline.run_all
open "ABRIR PAGINA - Barril Implicito.html"
