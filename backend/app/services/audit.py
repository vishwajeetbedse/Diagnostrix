"""Tamper-evident audit ledger.

Each entry stores the SHA-256 hash of its own content plus the previous
entry's hash. Editing or deleting any past entry breaks every hash after it,
and verify() pinpoints the first broken link.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from pathlib import Path

GENESIS = "0" * 64


def _digest(prev: str, seq: int, at: float, event: str, ref: str, actor: str, payload: dict) -> str:
    body = json.dumps({"seq": seq, "at": round(at, 3), "event": event, "ref": ref, "actor": actor, "payload": payload},
                      sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256((prev + body).encode("utf-8")).hexdigest()


class AuditLedger:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._lock = threading.Lock()
        with self._lock:
            self._db.execute("""CREATE TABLE IF NOT EXISTS ledger (
                seq INTEGER PRIMARY KEY, at REAL, event TEXT, ref TEXT, actor TEXT, payload TEXT, prev TEXT, hash TEXT)""")
            self._db.commit()

    def append(self, event: str, ref: str = "", payload: dict | None = None, actor: str = "Clinical Pharmacist · Station 04") -> dict:
        payload = payload or {}
        with self._lock:
            row = self._db.execute("SELECT seq, hash FROM ledger ORDER BY seq DESC LIMIT 1").fetchone()
            seq, prev = (row[0] + 1, row[1]) if row else (1, GENESIS)
            at = time.time()
            h = _digest(prev, seq, at, event, ref, actor, payload)
            self._db.execute("INSERT INTO ledger VALUES (?,?,?,?,?,?,?,?)",
                             (seq, round(at, 3), event, ref, actor, json.dumps(payload, ensure_ascii=False), prev, h))
            self._db.commit()
        return {"seq": seq, "at": round(at, 3), "event": event, "ref": ref, "actor": actor, "payload": payload, "prev": prev, "hash": h}

    def list(self, limit: int = 200) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT seq, at, event, ref, actor, payload, prev, hash FROM ledger ORDER BY seq DESC LIMIT ?", (limit,)).fetchall()
        return [{"seq": r[0], "at": r[1], "event": r[2], "ref": r[3], "actor": r[4], "payload": json.loads(r[5]), "prev": r[6], "hash": r[7]} for r in rows]

    def verify(self) -> dict:
        with self._lock:
            rows = self._db.execute("SELECT seq, at, event, ref, actor, payload, prev, hash FROM ledger ORDER BY seq").fetchall()
        prev = GENESIS
        for seq, at, event, ref, actor, payload, stored_prev, stored_hash in rows:
            expected = _digest(prev, seq, at, event, ref, actor, json.loads(payload))
            if stored_prev != prev or stored_hash != expected:
                return {"ok": False, "entries": len(rows), "brokenAt": seq, "detail": f"Entry #{seq} does not match its hash — the record was altered after it was written."}
            prev = stored_hash
        return {"ok": True, "entries": len(rows), "head": prev, "detail": f"All {len(rows)} entries verified; chain intact."}

    def tamper_demo(self) -> dict:
        """Training environment only: silently edit the oldest entry to demonstrate detection."""
        with self._lock:
            row = self._db.execute("SELECT seq, payload FROM ledger ORDER BY seq LIMIT 1").fetchone()
            if not row:
                return {"ok": False, "detail": "Ledger is empty."}
            payload = json.loads(row[1])
            payload["_edited"] = "value changed directly in the database"
            self._db.execute("UPDATE ledger SET payload = ? WHERE seq = ?", (json.dumps(payload), row[0]))
            self._db.commit()
        return {"ok": True, "seq": row[0]}
