"""RxNorm (US National Library of Medicine, RxNav REST API) — drug name normalisation."""
from __future__ import annotations

from .http import Fetcher

BASE = "https://rxnav.nlm.nih.gov/REST"
SOURCE = "NLM · RxNorm"
INGREDIENT_TTYS = {"IN", "PIN", "MIN"}


class RxNorm:
    def __init__(self, fetcher: Fetcher):
        self.f = fetcher

    async def approximate(self, term: str, max_entries: int = 4) -> list[dict]:
        got = await self.f.get_json(SOURCE, f"{BASE}/approximateTerm.json", {"term": term, "maxEntries": max_entries})
        cands = ((got.data or {}).get("approximateGroup") or {}).get("candidate") or []
        out, seen = [], set()
        for c in cands:
            if c.get("rxcui") and c["rxcui"] not in seen:
                seen.add(c["rxcui"])
                out.append({"rxcui": c["rxcui"], "score": float(c.get("score") or 0), "name": c.get("name")})
        return out

    async def properties(self, rxcui: str) -> dict | None:
        got = await self.f.get_json(SOURCE, f"{BASE}/rxcui/{rxcui}/properties.json")
        return (got.data or {}).get("properties")

    async def ingredients(self, rxcui: str) -> list[str]:
        props = await self.properties(rxcui)
        if props and props.get("tty") in INGREDIENT_TTYS:
            return [props["name"].lower()]
        got = await self.f.get_json(SOURCE, f"{BASE}/rxcui/{rxcui}/related.json", {"tty": "IN"})
        groups = ((got.data or {}).get("relatedGroup") or {}).get("conceptGroup") or []
        names = [p["name"].lower() for g in groups for p in (g.get("conceptProperties") or []) if p.get("name")]
        return sorted(set(names))

    async def resolve(self, term: str) -> dict | None:
        """Free text (brand, generic, misspelling) → ingredient names, with the matched RxNorm concept."""
        cands = await self.approximate(term)
        for c in cands:
            ings = await self.ingredients(c["rxcui"])
            if ings:
                props = await self.properties(c["rxcui"])
                return {"rxcui": c["rxcui"], "concept": (props or {}).get("name") or c.get("name"), "tty": (props or {}).get("tty"), "ingredients": ings, "score": c["score"]}
        return None

    async def display_names(self) -> list[str]:
        """Every drug name RxNav offers for autocomplete (cached for 30 days)."""
        got = await self.f.get_json(SOURCE, f"{BASE}/displaynames.json")
        return ((got.data or {}).get("displayTermsList") or {}).get("term") or []
