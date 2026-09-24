"""Import the DDInter drug–drug interaction database into local SQLite.

    python -m backend.tools.import_ddinter            # download (~25 MB) and import
    python -m backend.tools.import_ddinter --from-dir path/to/csvs   # import CSVs you downloaded by hand

CSV columns: DDInterID_A, Drug_A, DDInterID_B, Drug_B, Level
Source: https://ddinter.scbdd.com/download/  (free for academic / non-commercial use — check DDInter's terms)
"""
from __future__ import annotations

import argparse
import csv
import io
import sqlite3
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.app.config import settings  # noqa: E402

CODES = "ABDHLPRV"
URLS = ["https://ddinter.scbdd.com/static/media/download/ddinter_downloads_code_{c}.csv",
        "http://ddinter.scbdd.com/static/media/download/ddinter_downloads_code_{c}.csv"]


def fetch(code: str) -> str:
    last = None
    for tmpl in URLS:
        url = tmpl.format(c=code)
        try:
            r = httpx.get(url, timeout=60, follow_redirects=True, headers={"User-Agent": "Diagnostix-CDSS/2.0"})
            r.raise_for_status()
            return r.content.decode("utf-8-sig", errors="replace")
        except Exception as exc:
            last = exc
    raise RuntimeError(f"Could not download code {code}: {last}")


def rows_from(text: str):
    for row in csv.DictReader(io.StringIO(text)):
        a, b, level = (row.get("Drug_A") or "").strip(), (row.get("Drug_B") or "").strip(), (row.get("Level") or "Unknown").strip()
        if a and b:
            yield row.get("DDInterID_A", ""), a, row.get("DDInterID_B", ""), b, level or "Unknown"


def build(texts: list[str], out: Path) -> tuple[int, int]:
    """Write the SQLite interaction table from DDInter CSV texts. Returns (records, drugs)."""
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_suffix(".tmp")
    tmp.unlink(missing_ok=True)
    db = sqlite3.connect(tmp)
    db.executescript("""
        CREATE TABLE ddi (a TEXT, b TEXT, drug_a TEXT, drug_b TEXT, level TEXT, id_a TEXT, id_b TEXT);
        CREATE TABLE drugs (name TEXT PRIMARY KEY, display TEXT, ddinter_id TEXT);
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    """)
    seen, drugs = set(), {}
    for text in texts:
        for id_a, a, id_b, b, level in rows_from(text):
            key = (a.lower(), b.lower(), level)
            if key in seen:
                continue
            seen.add(key)
            db.execute("INSERT INTO ddi VALUES (?,?,?,?,?,?,?)", (a.lower(), b.lower(), a, b, level, id_a, id_b))
            drugs.setdefault(a.lower(), (a, id_a))
            drugs.setdefault(b.lower(), (b, id_b))
    db.executemany("INSERT INTO drugs VALUES (?,?,?)", [(k, v[0], v[1]) for k, v in drugs.items()])
    db.execute("CREATE INDEX ix_ab ON ddi (a, b)")
    db.execute("CREATE INDEX ix_b ON ddi (b)")
    db.executemany("INSERT INTO meta VALUES (?,?)", [
        ("pairs", str(len(seen))), ("drugs", str(len(drugs))), ("imported_at", str(int(time.time()))), ("files", str(len(texts)))])
    db.commit()
    db.close()
    tmp.replace(out)
    return len(seen), len(drugs)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from-dir", type=Path, help="folder containing ddinter_downloads_code_*.csv")
    args = ap.parse_args()

    texts = []
    for c in CODES:
        if args.from_dir:
            p = args.from_dir / f"ddinter_downloads_code_{c}.csv"
            if not p.exists():
                print(f"  skip {p.name} (not found)")
                continue
            texts.append(p.read_text(encoding="utf-8-sig", errors="replace"))
        else:
            print(f"  downloading code {c} …", flush=True)
            texts.append(fetch(c))

    out = settings.ddinter_db
    pairs, ndrugs = build(texts, out)
    print(f"\n  DDInter imported: {pairs:,} interaction records across {ndrugs:,} drugs → {out}")
    if not pairs:
        print("  WARNING: no rows imported — check the CSV files.")


if __name__ == "__main__":
    main()
