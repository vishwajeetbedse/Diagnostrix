"""DDInter — global drug–drug interaction database, imported into local SQLite.

Import once with `python -m backend.tools.import_ddinter`; afterwards lookups
are local, instant and work offline. DDInter grades each pair Major, Moderate,
Minor or Unknown. Absence from DDInter does not prove that no interaction
exists.
"""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

SOURCE = "DDInter"
LEVEL_RANK = {"Major": 3, "Moderate": 2, "Minor": 1, "Unknown": 0}

# Common name differences between DDInter and US/Indian usage.
SYNONYMS = {
    "acetaminophen": ["paracetamol"],
    "paracetamol": ["acetaminophen"],
    "lithium carbonate": ["lithium"],
    "salbutamol": ["albuterol"],
    "albuterol": ["salbutamol"],
    "adrenaline": ["epinephrine"],
    "epinephrine": ["adrenaline"],
}


def variants(name: str) -> list[str]:
    n = " ".join(name.lower().split())
    out = [n, *SYNONYMS.get(n, [])]
    first = n.split(" ")[0]
    if first != n and len(first) >= 4:
        out.append(first)
    for suffix in (" hydrochloride", " sodium", " potassium", " sulfate", " sulphate", " carbonate", " maleate", " besylate", " tartrate", " citrate", " calcium"):
        if n.endswith(suffix):
            out.append(n[: -len(suffix)])
    return list(dict.fromkeys(out))


class DDInter:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._db = None
        if path.exists():
            self._db = sqlite3.connect(f"file:{path}?mode=ro", uri=True, check_same_thread=False)

    @property
    def available(self) -> bool:
        return self._db is not None

    def meta(self) -> dict:
        if not self._db:
            return {"available": False}
        with self._lock:
            rows = dict(self._db.execute("SELECT key, value FROM meta").fetchall())
        return {"available": True, **rows}

    def _names(self, name: str) -> list[str]:
        return variants(name)

    def lookup(self, a: str, b: str) -> dict | None:
        if not self._db:
            return None
        best = None
        with self._lock:
            for x in self._names(a):
                for y in self._names(b):
                    for p, q in ((x, y), (y, x)):
                        row = self._db.execute("SELECT drug_a, drug_b, level, id_a, id_b FROM ddi WHERE a = ? AND b = ?", (p, q)).fetchall()
                        for r in row:
                            if best is None or LEVEL_RANK.get(r[2], 0) > LEVEL_RANK.get(best["level"], 0):
                                best = {"level": r[2], "drugA": r[0], "drugB": r[1], "idA": r[3], "idB": r[4], "source": SOURCE,
                                        "url": f"https://ddinter.scbdd.com/ddinter/drug-detail/{r[3]}/"}
        return best

    def interactions(self, name: str, limit: int = 400) -> dict:
        """All partners of one drug, with counts by severity."""
        if not self._db:
            return {"available": False, "counts": {}, "items": []}
        items = {}
        with self._lock:
            for v in self._names(name):
                rows = self._db.execute(
                    "SELECT b, drug_b, level FROM ddi WHERE a = ? UNION SELECT a, drug_a, level FROM ddi WHERE b = ?", (v, v)
                ).fetchall()
                for key, display, level in rows:
                    cur = items.get(key)
                    if not cur or LEVEL_RANK.get(level, 0) > LEVEL_RANK.get(cur["level"], 0):
                        items[key] = {"name": display, "level": level}
        ranked = sorted(items.values(), key=lambda r: (-LEVEL_RANK.get(r["level"], 0), r["name"]))
        counts = {}
        for r in ranked:
            counts[r["level"]] = counts.get(r["level"], 0) + 1
        return {"available": True, "total": len(ranked), "counts": counts, "items": ranked[:limit]}

    def known(self, name: str) -> str | None:
        """Canonical DDInter name if the drug exists in the database."""
        if not self._db:
            return None
        with self._lock:
            for v in self._names(name):
                row = self._db.execute("SELECT name FROM drugs WHERE name = ?", (v,)).fetchone()
                if row:
                    return row[0]
        return None

    def search_names(self, prefix: str, limit: int = 8) -> list[str]:
        if not self._db or len(prefix) < 2:
            return []
        with self._lock:
            rows = self._db.execute("SELECT display FROM drugs WHERE name LIKE ? ORDER BY length(name) LIMIT ?", (prefix.lower() + "%", limit)).fetchall()
        return [r[0] for r in rows]
