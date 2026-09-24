"""Curated knowledge base (the pharmacy team's formulary).

Authoritative for dose ceilings. Loaded from data/formulary.json so the
pharmacy team can edit data without touching code.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from ..config import settings


class Formulary:
    def __init__(self, path: Path):
        raw = json.loads(path.read_text(encoding="utf-8"))
        self.version: str = raw["version"]
        self.note: str = raw.get("note", "")
        self.drugs: list[dict] = raw["drugs"]
        self.monographs: dict[str, dict] = raw["monographs"]
        self.combinations: dict[str, list[str]] = raw.get("combinations", {})
        self.frequencies: list[dict] = raw["frequencies"]
        self._by_id = {d["id"]: d for d in self.drugs}

    @staticmethod
    def pair_key(a: str, b: str) -> str:
        return "|".join(sorted([a, b]))

    def drug(self, drug_id: str) -> dict | None:
        return self._by_id.get(drug_id)

    def frequency(self, freq_id: str) -> dict:
        return next((f for f in self.frequencies if f["id"] == freq_id), self.frequencies[0])

    def monograph(self, a: str, b: str) -> dict | None:
        return self.monographs.get(self.pair_key(a, b))

    def contraindicated(self, a: str, b: str) -> bool:
        da, db = self.drug(a), self.drug(b)
        if not da or not db:
            return False
        return b in da["contraindicatedWith"] or a in db["contraindicatedWith"]

    def integrity(self) -> dict:
        issues = []
        for d in self.drugs:
            for other in d["contraindicatedWith"]:
                o = self.drug(other)
                if not o:
                    issues.append(f"{d['name']}: unknown contraindication '{other}'")
                elif d["id"] not in o["contraindicatedWith"]:
                    issues.append(f"{d['name']} ↔ {o['name']}: recorded on one side only")
                if not self.monograph(d["id"], other):
                    issues.append(f"{d['name']} ↔ {other}: missing monograph")
        return {"ok": not issues, "issues": issues}


@lru_cache(maxsize=1)
def get_formulary() -> Formulary:
    return Formulary(settings.formulary_path)
