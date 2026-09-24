#!/usr/bin/env bash
# Start Diagnostix (Git Bash / macOS / Linux):  bash start.sh
cd "$(dirname "$0")"
if [ -f .venv/Scripts/activate ]; then source .venv/Scripts/activate; elif [ -f .venv/bin/activate ]; then source .venv/bin/activate; fi
python -m backend.app.main
