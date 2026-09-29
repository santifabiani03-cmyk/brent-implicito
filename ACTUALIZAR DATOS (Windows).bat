@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Actualizando datos de Barril Implicito (tarda 2-5 minutos)...
where python >nul 2>nul || (echo Falta Python. Instalalo desde https://www.python.org/downloads/ marcando "Add to PATH". & pause & exit /b 1)
python -m pip install -q -r requirements.txt
python -m pipeline.run_all
start "" "ABRIR PAGINA - Barril Implicito.html"
pause
