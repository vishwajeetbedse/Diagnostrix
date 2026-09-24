"""Persistent response cache (SQLite).

Every external response is stored with the time it was fetched. Fresh entries
are served without a network call; when a source fails, the stale entry is
served instead and flagged, so the demo survives flaky venue Wi-Fi.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path


class Cache:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, source TEXT, value TEXT, fetched_at REAL)"
            )
            self._db.commit()

    def get(self, key: str) -> tuple[object, float] | None:
        with self._lock:
            row = self._db.execute("SELECT value, fetched_at FROM cache WHERE key = ?", (key,)).fetchone()
        return (json.loads(row[0]), row[1]) if row else None

    def put(self, key: str, source: str, value: object) -> float:
        now = time.time()
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO cache (key, source, value, fetched_at) VALUES (?, ?, ?, ?)",
                (key, source, json.dumps(value), now),
            )
            self._db.commit()
        return now

    def stats(self) -> dict:
        with self._lock:
            rows = self._db.execute("SELECT source, COUNT(*), MAX(fetched_at) FROM cache GROUP BY source").fetchall()
        return {r[0]: {"entries": r[1], "latest": r[2]} for r in rows}
