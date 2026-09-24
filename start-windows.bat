@echo off
REM Start Diagnostix (double-click). Run setup.sh once first.
cd /d "%~dp0"
REM Optional settings (see .env.example): KEY=value lines, # comments ignored.
if exist .env for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do if not "%%b"=="" set "%%a=%%b"
if exist .venv\Scripts\activate.bat call .venv\Scripts\activate.bat
start "" http://localhost:8000
python -m backend.app.main
pause
