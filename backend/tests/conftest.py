"""Shared fixtures: a throwaway data directory with a tiny synthetic DDInter table, and app/container in fixtures mode (no network)."""
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("DX_LLM", "stub")

from backend.tools.import_ddinter import build  # noqa: E402

DDINTER_CSV = """DDInterID_A,Drug_A,DDInterID_B,Drug_B,Level
DDInter1,Warfarin,DDInter2,Aspirin,Major
DDInter1,Warfarin,DDInter3,Omeprazole,Moderate
DDInter4,Simvastatin,DDInter5,Clarithromycin,Major
DDInter6,Paracetamol,DDInter1,Warfarin,Minor
DDInter7,Sertraline,DDInter8,Tramadol,Major
"""


@pytest.fixture()
def data_dir(tmp_path):
    build([DDINTER_CSV], tmp_path / "ddinter.sqlite3")
    return tmp_path


@pytest.fixture()
def container(data_dir):
    from backend.app.config import Settings
    from backend.app.container import Container

    return Container(Settings(sources="fixtures", data_dir=data_dir))


@pytest.fixture()
def client(data_dir):
    from fastapi.testclient import TestClient

    from backend.app.config import Settings
    from backend.app.main import create_app

    app = create_app(Settings(sources="fixtures", data_dir=data_dir))
    with TestClient(app) as c:
        yield c
