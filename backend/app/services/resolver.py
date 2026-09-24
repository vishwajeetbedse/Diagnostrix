"""Name resolution: free text → active ingredient(s).

Order of precedence (first hit wins):
  1. Curated formulary names, alternative names and brands   (local, instant)
  2. Combination products, e.g. Combiflam → ibuprofen + acetaminophen (local)
  3. DDInter drug names                                       (local, instant)
  4. RxNorm approximate match                                 (network, cached)
"""
from __future__ import annotations

import re

from ..core.formulary import Formulary
from ..sources.ddinter import DDInter
from ..sources.http import SourceUnavailable
from ..sources.rxnorm import RxNorm

_FORMS = re.compile(r"\b(tab|tabs|tablet|tablets|cap|caps|capsule|capsules|syrup|susp|suspension|drops|inj|injection|oral|po|iv|er|sr|xr|ds)\b")


def normalise(text: str) -> str:
    t = (text or "").lower().replace("®", "").replace("™", "")
    t = re.sub(r"(\d)\s*-\s*", r"\1 ", t).replace("-", " ")
    t = re.sub(r"\b\d+(?:\.\d+)?\s*(?:mg|mcg|µg|g|ml|iu|%)?(?=\s|$|/)", " ", t)
    t = re.sub(r"/\s*\d+.*$", " ", t)
    t = _FORMS.sub(" ", t)
    return " ".join(t.split())


class Resolver:
    def __init__(self, kb: Formulary, ddinter: DDInter, rxnorm: RxNorm | None):
        self.kb, self.ddinter, self.rxnorm = kb, ddinter, rxnorm
        self.index: dict[str, tuple[list[str], str]] = {}
        for d in kb.drugs:
            self._add(d["id"], [d["id"]], "generic")
            self._add(d["name"], [d["id"]], "generic")
            self._add(d["name"].split(" ")[0], [d["id"]], "generic")
            self._add(d["aka"], [d["id"]], "generic" if d["aka"].lower() == d["name"].lower() else "alias")
            for b in d.get("brands", []):
                self._add(b, [d["id"]], "brand")
        for brand, ids in kb.combinations.items():
            self._add(brand, ids, "combination")

    def _add(self, key: str, ids: list[str], via: str):
        k = normalise(key)
        if k and k not in self.index:
            self.index[k] = (ids, via)

    def local_id(self, name: str) -> str | None:
        """Curated drug id for an ingredient or product name (single-ingredient only)."""
        k = normalise(name)
        hit = self.index.get(k) or self.index.get(k.split(" ")[0] if k else "")
        return hit[0][0] if hit and len(hit[0]) == 1 else None

    async def resolve(self, entry: str, allow_network: bool = True) -> dict:
        key = normalise(entry)
        base = {"input": entry, "normalised": key}
        if not key:
            return {**base, "ingredients": [], "via": None}
        hit = self.index.get(key) or self.index.get(key.split(" ")[0])
        if hit:
            ids, via = hit
            return {**base, "ingredients": [self.kb.drug(i)["name"].lower() for i in ids], "curated": ids, "via": via}
        known = self.ddinter.known(key)
        if known:
            return {**base, "ingredients": [known], "curated": [], "via": "ddinter"}
        if allow_network and self.rxnorm:
            try:
                rx = await self.rxnorm.resolve(key)
            except SourceUnavailable:
                rx = None
            if rx:
                curated = [cid for cid in (self.local_id(i) for i in rx["ingredients"]) if cid]
                return {**base, "ingredients": rx["ingredients"], "curated": curated, "via": "rxnorm", "rxcui": rx["rxcui"], "concept": rx["concept"]}
        return {**base, "ingredients": [], "curated": [], "via": None}
