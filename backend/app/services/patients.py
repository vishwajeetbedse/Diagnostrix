"""Patient registry — demographics reused across verifications.

A plain SQLite table; the audit ledger references patients by id, so a
patient's record can change without rewriting past (hash-chained) entries.
"""
from __future__ import annotations

import sqlite3
import threading
import time
from pathlib import Path

FIELDS = ("name", "mrn", "age", "sex", "weight", "height", "scr")


class PatientStore:
    """CRUD over the `patients` table. Thread-safe: one connection guarded by a lock, like AuditLedger."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._db.execute("""CREATE TABLE IF NOT EXISTS patients (
                id INTEGER PRIMARY KEY, name TEXT NOT NULL, mrn TEXT UNIQUE, age REAL, sex TEXT,
                weight REAL, height REAL, scr REAL, created_at REAL, updated_at REAL)""")
            self._db.commit()

    @staticmethod
    def _clean(data: dict) -> dict:
        """Normalise a blank MRN to NULL.

        MRN is UNIQUE, and SQLite treats every NULL as distinct, so patients
        registered without an MRN never collide with each other; an empty
        string would.
        """
        if "mrn" in data:
            data = {**data, "mrn": (data["mrn"] or "").strip() or None}
        return data

    @staticmethod
    def _row(r: sqlite3.Row | None) -> dict | None:
        return dict(r) if r else None

    def create(self, data: dict) -> dict:
        """Insert a patient and return the stored row (with id and timestamps).

        Raises sqlite3.IntegrityError on a duplicate MRN; the API maps that to 409.
        """
        data = self._clean(data)
        now = time.time()
        with self._lock:
            cur = self._db.execute(
                f"INSERT INTO patients ({', '.join(FIELDS)}, created_at, updated_at) VALUES ({', '.join('?' * len(FIELDS))}, ?, ?)",
                (*(data.get(k) for k in FIELDS), now, now))
            self._db.commit()
        return self.get(cur.lastrowid)

    def get(self, pid: int) -> dict | None:
        """Return one patient by id, or None if it does not exist."""
        with self._lock:
            return self._row(self._db.execute("SELECT * FROM patients WHERE id = ?", (pid,)).fetchone())

    def list(self, q: str = "", limit: int = 100) -> list[dict]:
        """Substring search on name or MRN, most recently updated first.

        An empty query lists everyone. Recency order puts the patient the
        pharmacist was just working on at the top of the verify-page picker.
        """
        like = f"%{q.strip()}%"
        with self._lock:
            rows = self._db.execute(
                "SELECT * FROM patients WHERE name LIKE ? OR mrn LIKE ? ORDER BY updated_at DESC LIMIT ?", (like, like, limit)).fetchall()
        return [dict(r) for r in rows]

    def update(self, pid: int, patch: dict) -> dict | None:
        """Apply a partial update (unknown keys ignored) and return the new row.

        Only whitelisted FIELDS reach the SQL, so interpolating the column
        names is safe. Past audit entries are unaffected: they store the
        patient id plus the demographics used at the time.
        """
        patch = self._clean({k: v for k, v in patch.items() if k in FIELDS})
        if patch:
            with self._lock:
                self._db.execute(f"UPDATE patients SET {', '.join(f'{k} = ?' for k in patch)}, updated_at = ? WHERE id = ?",
                                 (*patch.values(), time.time(), pid))
                self._db.commit()
        return self.get(pid)

    def delete(self, pid: int) -> bool:
        """Delete a patient; True if a row was removed. Audit entries that reference the id are kept."""
        with self._lock:
            cur = self._db.execute("DELETE FROM patients WHERE id = ?", (pid,))
            self._db.commit()
        return cur.rowcount > 0
