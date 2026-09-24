@echo off
REM Start Diagnostix (double-click). Run setup.sh once first.
cd /d "%~dp0"
if exist .venv\Scripts\activate.bat call .venv\Scripts\activate.bat
start "" http://localhost:8000
python -m backend.app.main
pause
