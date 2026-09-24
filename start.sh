#!/usr/bin/env bash
# Start Diagnostix (Git Bash / macOS / Linux):  bash start.sh
cd "$(dirname "$0")"
if [ -f .env ]; then set -a; . ./.env; set +a; fi   # optional settings, see .env.example
if [ -f .venv/Scripts/activate ]; then source .venv/Scripts/activate; elif [ -f .venv/bin/activate ]; then source .venv/bin/activate; fi
python -m backend.app.main
