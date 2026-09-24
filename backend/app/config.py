"""Runtime settings, read once from environment variables.

    DX_SOURCES       live (default) | offline | fixtures
                     live     = call openFDA / RxNorm, cache results, serve stale cache on failure
                     offline  = never touch the network; answer from cache and local data only
                     fixtures = synthetic test data (automated tests only — never real)
    OPENFDA_API_KEY  optional; raises the openFDA limit from 1,000 to 120,000 requests/day
    DX_LLM           hf (default) | stub | off
    DX_MODEL         Hugging Face model id (default Qwen/Qwen2.5-1.5B-Instruct)
    DX_DATA_DIR      where the cache, DDInter, audit and patient databases live (default backend/data)
    PORT             HTTP port (default 8000)
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_DIR = BACKEND_DIR.parent


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
