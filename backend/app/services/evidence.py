"""Evidence aggregation — every fact tagged with the source it came from.

Tier                 Source                         Decides alerts?
Curated formulary    pharmacy team JSON             yes (dose limits, monographs)
DDInter              local SQLite, ~2k drugs        yes (Major / Moderate pairs)
FDA label            openFDA /drug/label            no — quoted evidence
FAERS                openFDA /drug/event            no — real-world signal
"""
from __future__ import annotations

import asyncio
import itertools

from ..core.formulary import Formulary
from ..sources.ddinter import DDInter, variants
from ..sources.http import SourceUnavailable
from ..sources.openfda import OpenFDA, label_mentions
from .resolver import Resolver

CLASS_TERMS = {
    "nonsteroidal anti-inflammatory": ["NSAID", "nonsteroidal anti-inflammatory"],
    "vitamin k antagonist": ["anticoagulant", "vitamin K antagonist"],
    "macrolide": ["macrolide"],
    "azole antifungal": ["azole"],
    "antiarrhythmic": ["antiarrhythmic"],
    "opioid agonist": ["opioid"],
    "serotonin reuptake inhibitor": ["serotonergic", "SSRI"],
    "monoamine oxidase inhibitor": ["MAO inhibitor", "MAOI", "monoamine oxidase"],
    "cardiac glycoside": ["cardiac glycoside", "digitalis"],
    "mood stabilizer": ["lithium"],
    "hmg-coa reductase inhibitor": ["statin", "HMG-CoA reductase"],
    "anti-epileptic": ["antiepileptic", "anticonvulsant"],
}

SEVERITY_ORDER = ["contraindicated", "major", "moderate", "minor", "none"]


async def _safe(coro):
    try:
        return await coro, None
    except SourceUnavailable as exc:
        return None, str(exc)


def terms_for(name: str, label: dict | None, kb_drug: dict | None) -> list[str]:
    terms = list(variants(name))
    if kb_drug:
        terms += [kb_drug["name"], kb_drug["aka"], *kb_drug.get("brands", [])]
    if label:
        terms += label.get("brandNames", [])[:3]
        for cls in label.get("pharmClass", []):
            low = cls.lower()
            for key, words in CLASS_TERMS.items():
                if key in low:
                    terms += words
    return list(dict.fromkeys(t for t in terms if t))


class Evidence:
    def __init__(self, kb: Formulary, ddinter: DDInter, openfda: OpenFDA, resolver: Resolver):
        self.kb, self.ddinter, self.fda, self.resolver = kb, ddinter, openfda, resolver

    async def label(self, ingredient: str):
        res, err = await _safe(self.fda.label(ingredient))
        if res is None:
            return None, None, err
        label, got = res
        return label, got.provenance() if got else None, None

    async def pair(self, a: str, b: str) -> dict:
        ida, idb = self.resolver.local_id(a), self.resolver.local_id(b)
        da, db = (self.kb.drug(ida) if ida else None), (self.kb.drug(idb) if idb else None)
        mono = self.kb.monograph(ida, idb) if (ida and idb and self.kb.contraindicated(ida, idb)) else None
        (la, pa, ea), (lb, pb, eb) = await asyncio.gather(self.label(a), self.label(b))
        return {
            "a": a, "b": b,
            "curated": {"monograph": mono, "drugs": [bool(da), bool(db)], "version": self.kb.version},
            "ddinter": self.ddinter.lookup(a, b) if self.ddinter.available else None,
            "ddinterAvailable": self.ddinter.available,
            "label": {
                "aMentionsB": label_mentions(la, terms_for(b, lb, db)),
                "bMentionsA": label_mentions(lb, terms_for(a, la, da)),
                "a": _label_head(la, pa), "b": _label_head(lb, pb),
                "errors": [e for e in (ea, eb) if e],
            },
        }

    async def drug(self, ingredient: str) -> dict:
        cid = self.resolver.local_id(ingredient)
        kbd = self.kb.drug(cid) if cid else None
        label, prov, err = await self.label(ingredient)
        return {
            "ingredient": ingredient,
            "curated": kbd,
            "label": label, "labelProvenance": prov, "labelError": err,
            "ddinter": self.ddinter.interactions(ingredient, limit=300),
        }

    async def faers(self, ingredient: str) -> dict:
        res, err = await _safe(self.fda.drug_profile(ingredient))
        return res or {"ingredient": ingredient, "error": err}

    async def signal(self, a: str, b: str) -> dict:
        res, err = await _safe(self.fda.pair_signal(a, b))
        return res or {"a": a, "b": b, "error": err}

    async def screen(self, entries: list[str]) -> dict:
        resolved = await asyncio.gather(*(self.resolver.resolve(e) for e in entries))
        sources: dict[str, list[str]] = {}
        for r in resolved:
            for ing in r["ingredients"]:
                sources.setdefault(ing, []).append(r["input"])
        findings = []
        for ing, ents in sources.items():
            if len(ents) > 1:
                cid = self.resolver.local_id(ing)
                d = self.kb.drug(cid) if cid else None
                findings.append({"type": "duplicate", "severity": "major", "ingredient": ing, "entries": ents,
                                 "adultMax": d["adultMaxDaily"] if d else None})
        cells = []
        for x, y in itertools.combinations(sources.keys(), 2):
            ix, iy = self.resolver.local_id(x), self.resolver.local_id(y)
            mono = self.kb.monograph(ix, iy) if (ix and iy and self.kb.contraindicated(ix, iy)) else None
            glb = self.ddinter.lookup(x, y) if self.ddinter.available else None
            if mono:
                sev, src = ("contraindicated" if mono["severity"] == "Contraindicated" else "major"), "Curated KB"
            elif glb and glb["level"] in ("Major", "Moderate", "Minor"):
                sev, src = glb["level"].lower(), "DDInter"
            else:
                sev, src = "none", None
            cell = {"a": x, "b": y, "severity": sev, "source": src, "monograph": mono, "ddinter": glb,
                    "entries": [sources[x][0], sources[y][0]]}
            cells.append(cell)
            if sev != "none":
                findings.append({"type": "interaction", **cell})
        findings.sort(key=lambda f: SEVERITY_ORDER.index(f["severity"]))
        return {
            "resolved": resolved,
            "ingredients": list(sources.keys()),
            "cells": cells,
            "findings": findings,
            "unresolved": [r["input"] for r in resolved if not r["ingredients"]],
            "ddinterAvailable": self.ddinter.available,
        }


def _label_head(label: dict | None, prov: dict | None) -> dict | None:
    if not label:
        return None
    return {k: label.get(k) for k in ("setId", "effectiveTime", "brandNames", "manufacturer", "pharmClass", "dailyMedUrl")} | {"provenance": prov}
