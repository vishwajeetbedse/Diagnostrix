#!/usr/bin/env bash
# One-time setup (Git Bash on Windows, macOS or Linux). Run from the project folder:  bash setup.sh
set -e
cd "$(dirname "$0")"

if command -v py >/dev/null 2>&1; then PY="py -3.12"; else PY="python3"; fi
echo "==> Creating virtual environment with: $PY"
[ -d .venv ] || $PY -m venv .venv
if [ -f .venv/Scripts/activate ]; then source .venv/Scripts/activate; else source .venv/bin/activate; fi

echo "==> Installing Python packages (a few minutes: PyTorch is large)"
python -m pip install --upgrade pip -q
python -m pip install -r requirements.txt

if command -v npm >/dev/null 2>&1; then
  echo "==> Building the frontend"
  (cd frontend && npm install --no-audit --no-fund && npm run build)
else
  echo "==> npm not found — using the prebuilt frontend in frontend/dist (install Node.js 22 LTS to rebuild)"
fi

echo "==> Importing the DDInter interaction database (~25 MB download)"
python -m backend.tools.import_ddinter || echo "   DDInter import failed — see README (manual download option)."

echo "==> Checking live data sources"
python -m backend.tools.doctor

echo
echo "Setup complete. Optional, recommended before the event:  python -m backend.tools.warm_cache"
echo "Start the app:  bash start.sh   →  http://localhost:8000"
