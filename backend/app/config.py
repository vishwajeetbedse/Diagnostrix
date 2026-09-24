"""Runtime settings, read once from environment variables.

    DX_SOURCES       live (default) | offline | fixtures
                     live     = call openFDA / RxNorm, cache results, serve stale cache on failure
                     offline  = never touch the network; answer from cache and local data only
                     fixtures = synthetic test data (automated tests only — never real)
    OPENFDA_API_KEY  optional; raises the openFDA limit from 1,000 to 120,000 requests/day
    DX_LLM           hf (default) | stub | off
    DX_MODEL         Hugging Face model id (default Qwen/Qwen2.5-1.5B-Instruct)
    DX_DTYPE         model precision: auto (default) | float32 | bfloat16 | float16
    DX_DATA_DIR      where the cache, DDInter, audit and patient databases live (default backend/data)
    PORT             HTTP port (default 8000)

Values can also come from a `.env` file in the project folder (see .env.example).
Variables already set in the environment take precedence over `.env`.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent


def load_dotenv(path: Path) -> None:
    """Load KEY=value lines into os.environ without overriding variables already set.

    Done here rather than in the start scripts so every way of launching the
    app (start.sh, start-windows.bat, `python -m backend.app.main`, tools)
    sees the same settings. Blank values are skipped, so `OPENFDA_API_KEY=`
    means "not set". Kept dependency-free on purpose: no python-dotenv.
    """
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = (part.strip() for part in line.split("=", 1))
        value = value.strip('"').strip("'")
        if key and value:
            os.environ.setdefault(key, value)


if "pytest" not in sys.modules:  # tests stay hermetic: a developer's .env must not leak into them
    load_dotenv(PROJECT_DIR / ".env")


@dataclass(frozen=True)
class Settings:
    sources: str = field(default_factory=lambda: os.environ.get("DX_SOURCES", "live").strip().lower())
    openfda_key: str | None = field(default_factory=lambda: os.environ.get("OPENFDA_API_KEY") or None)
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("DX_DATA_DIR", BACKEND_DIR / "data")))
    frontend_dist: Path = PROJECT_DIR / "frontend" / "dist"
    port: int = field(default_factory=lambda: int(os.environ.get("PORT", "8000")))
    http_timeout: float = 12.0
    http_concurrency: int = 4
    cache_ttl_days: int = 30

    @property
    def formulary_path(self) -> Path:
        return BACKEND_DIR / "data" / "formulary.json"

    @property
    def cache_db(self) -> Path:
        return self.data_dir / "cache.sqlite3"

    @property
    def ddinter_db(self) -> Path:
        return self.data_dir / "ddinter.sqlite3"

    @property
    def audit_db(self) -> Path:
        return self.data_dir / "audit.sqlite3"

    @property
    def patients_db(self) -> Path:
        return self.data_dir / "patients.sqlite3"


settings = Settings()
