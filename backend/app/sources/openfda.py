"""openFDA client — FDA drug labels and FAERS adverse event reports.

FAERS counts are *reports*, not incidence: a report shows a reaction was
suspected, not that the drug caused it. Everything returned here carries its
query URL so the UI can cite it.
"""
from __future__ import annotations

import asyncio
import math
import re

from .http import Fetcher, Fetched

LABEL_URL = "https://api.fda.gov/drug/label.json"
EVENT_URL = "https://api.fda.gov/drug/event.json"
SOURCE_LABEL = "openFDA · drug labels"
SOURCE_FAERS = "openFDA · FAERS"

REACTION = "patient.reaction.reactionmeddrapt.exact"
LABEL_SECTIONS = [
    ("boxed_warning", "Boxed warning"),
    ("contraindications", "Contraindications"),
    ("drug_interactions", "Drug interactions"),
    ("warnings_and_cautions", "Warnings and precautions"),
    ("warnings", "Warnings"),
    ("dosage_and_administration", "Dosage and administration"),
    ("pediatric_use", "Pediatric use"),
    ("geriatric_use", "Geriatric use"),
    ("adverse_reactions", "Adverse reactions"),
]
# Leading section heading, e.g. "7 DRUG INTERACTIONS 7.1 " — upper-case words with optional numbering.
_HEADING = re.compile(r"^\s*(?:\d+(?:\.\d+)*\s+)?(?:[A-Z]{2,}[A-Z&,/()-]*\s+)+(?:\d+(?:\.\d+)*\s+)?")


def _q(value: str) -> str:
    return '"' + value.replace('"', "").strip() + '"'


def drug_query(name: str) -> str:
    return f"patient.drug.openfda.generic_name:{_q(name)}"


class OpenFDA:
    def __init__(self, fetcher: Fetcher, api_key: str | None = None):
        self.f = fetcher
        self.key = api_key

    def _params(self, **p) -> dict:
        if self.key:
            p["api_key"] = self.key
        return p

    # ------------------------------------------------------------ labels
    async def label(self, ingredient: str) -> tuple[dict | None, Fetched | None]:
        name = ingredient.strip().lower()
        for field in ("openfda.generic_name", "openfda.substance_name"):
            got = await self.f.get_json(SOURCE_LABEL, LABEL_URL, self._params(search=f"{field}:{_q(name)}", limit=10))
            results = (got.data or {}).get("results", []) if not got.not_found else []
            if results:
                return _best_label(results, name), got
        return None, got

    # ------------------------------------------------------------- FAERS
    async def total(self, search: str | None = None) -> tuple[int, Fetched]:
        params = self._params(limit=1)
        if search:
            params["search"] = search
        got = await self.f.get_json(SOURCE_FAERS, EVENT_URL, params)
        if got.not_found or not got.data:
            return 0, got
        return int(got.data.get("meta", {}).get("results", {}).get("total", 0)), got

    async def count(self, search: str | None, field: str, limit: int = 20) -> tuple[list[dict], Fetched]:
        params = self._params(count=field, limit=limit)
        if search:
            params["search"] = search
        got = await self.f.get_json(SOURCE_FAERS, EVENT_URL, params)
        if got.not_found or not got.data:
            return [], got
        return got.data.get("results", []), got

    async def drug_profile(self, ingredient: str) -> dict:
        q = drug_query(ingredient)
        (total, g_total), (reactions, g_rx), (serious, _), (deaths, _), (hosp, _), countries, years = await asyncio.gather(
            self.total(q),
            self.count(q, REACTION, 20),
            self.total(f"{q} AND serious:1"),
            self.total(f"{q} AND seriousnessdeath:1"),
            self.total(f"{q} AND seriousnesshospitalization:1"),
            self._countries(q),
            self._years(q),
        )
        return {
            "ingredient": ingredient,
            "reports": total,
            "serious": serious,
            "deaths": deaths,
            "hospitalisations": hosp,
            "reactions": [{"term": r["term"], "count": r["count"]} for r in reactions],
            "countries": countries,
            "years": years,
            "provenance": g_total.provenance(),
            "query": {"search": q, "reactionsUrl": g_rx.url},
        }

    async def _countries(self, q: str) -> list[dict]:
        for field in ("occurcountry.exact", "occurcountry"):
            try:
                rows, _ = await self.count(q, field, 12)
                if rows:
                    return [{"term": r["term"], "count": r["count"]} for r in rows]
            except Exception:
                continue
        return []

    async def _years(self, q: str) -> list[dict]:
        try:
            rows, _ = await self.count(q, "receivedate", 1000)
        except Exception:
            return []
        by_year: dict[str, int] = {}
        for r in rows:
            key = str(r.get("time") or r.get("term") or "")[:4]
            if key.isdigit():
                by_year[key] = by_year.get(key, 0) + int(r.get("count", 0))
        return [{"year": int(y), "count": c} for y, c in sorted(by_year.items())]

    # ---------------------------------------------------------- signals
    async def pair_signal(self, a: str, b: str, top: int = 8) -> dict:
        """Reporting odds ratios for the reactions most reported with both drugs.

        For each reaction R, compares the odds of R in reports mentioning the
        drug set against all other FAERS reports (standard disproportionality).
        """
        qa, qb = drug_query(a), drug_query(b)
        qab = f"{qa} AND {qb}"
        (n_all, g_all), (n_a, _), (n_b, _), (n_ab, g_ab), (rx_ab, _), (rx_a, _), (rx_b, _) = await asyncio.gather(
            self.total(None), self.total(qa), self.total(qb), self.total(qab),
            self.count(qab, REACTION, top), self.count(qa, REACTION, 1000), self.count(qb, REACTION, 1000),
        )
        map_a = {r["term"]: r["count"] for r in rx_a}
        map_b = {r["term"]: r["count"] for r in rx_b}

        async def one(row):
            term, a_ab = row["term"], row["count"]
            r_q = f"{REACTION}:{_q(term)}"
            n_r, _ = await self.total(r_q)
            a_a = map_a.get(term)
            if a_a is None:
                a_a, _ = await self.total(f"{qa} AND {r_q}")
            a_b = map_b.get(term)
            if a_b is None:
                a_b, _ = await self.total(f"{qb} AND {r_q}")
            return {
                "reaction": term,
                "reports": {"pair": a_ab, "a": a_a, "b": a_b, "all": n_r},
                "pair": ror(a_ab, n_ab, n_r, n_all),
                "a": ror(a_a, n_a, n_r, n_all),
                "b": ror(a_b, n_b, n_r, n_all),
            }

        rows = await asyncio.gather(*(one(r) for r in rx_ab[:top])) if n_ab else []
        for r in rows:
            single = max([x["ror"] for x in (r["a"], r["b"]) if x and x["ror"]] or [0])
            r["excess"] = round(r["pair"]["ror"] / single, 2) if (r["pair"] and r["pair"]["ror"] and single) else None
        return {
            "a": a, "b": b,
            "totals": {"all": n_all, "a": n_a, "b": n_b, "pair": n_ab},
            "reactions": rows,
            "provenance": g_ab.provenance(),
            "method": "Reporting odds ratio (ROR) with 95% CI. Signal when ≥ 3 reports and lower CI > 1.",
        }


def ror(a: int, n_x: int, n_r: int, n_all: int) -> dict | None:
    """2×2 table: a = X with R, b = X without R, c = R without X, d = neither."""
    if not (a and n_x and n_r and n_all):
        return None
    b = n_x - a
    c = n_r - a
    d = n_all - n_x - c
    if min(b, c, d) <= 0:
        return None
    value = (a / b) / (c / d)
    se = math.sqrt(1 / a + 1 / b + 1 / c + 1 / d)
    lo, hi = math.exp(math.log(value) - 1.96 * se), math.exp(math.log(value) + 1.96 * se)
    return {"ror": round(value, 2), "lo": round(lo, 2), "hi": round(hi, 2), "n": a, "signal": a >= 3 and lo > 1}


# --------------------------------------------------------------- helpers
def _clean(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    if text.upper().startswith("WARNING"):  # keep boxed-warning titles
        return text
    return _HEADING.sub("", text, count=1)


def _best_label(results: list[dict], name: str) -> dict:
    def score(r):
        o = r.get("openfda", {})
        generics = [g.lower() for g in o.get("generic_name", [])]
        exact = any(g == name or g.startswith(name + " ") and " and " not in g for g in generics)
        single = not any(" and " in g or "," in g for g in generics)
        return (exact, single, "drug_interactions" in r, r.get("effective_time", ""))

    best = max(results, key=score)
    o = best.get("openfda", {})
    sections = []
    for key, title in LABEL_SECTIONS:
        if key == "warnings" and any(s["key"] == "warnings_and_cautions" for s in sections):
            continue
        if best.get(key):
            text = _clean(" ".join(best[key]))
            if text:
                sections.append({"key": key, "title": title, "text": text[:8000], "truncated": len(text) > 8000})
    return {
        "setId": best.get("set_id"),
        "effectiveTime": best.get("effective_time"),
        "brandNames": o.get("brand_name", [])[:6],
        "genericNames": o.get("generic_name", [])[:3],
        "manufacturer": (o.get("manufacturer_name") or [None])[0],
        "pharmClass": [c.replace(" [EPC]", "") for c in o.get("pharm_class_epc", [])][:3],
        "rxcui": o.get("rxcui", [])[:5],
        "sections": sections,
        "dailyMedUrl": f"https://dailymed.nlm.nih.gov/dailymed/lookup.cfm?setid={best['set_id']}" if best.get("set_id") else None,
    }


_SENT = re.compile(r"(?<=[.;])\s+(?=[A-Z(])")


def label_mentions(label: dict | None, terms: list[str], sections=("boxed_warning", "contraindications", "drug_interactions", "warnings_and_cautions", "warnings")) -> list[dict]:
    """Sentences in one drug's label that mention another drug (deterministic text match)."""
    if not label:
        return []
    pats = [re.compile(rf"\b{re.escape(t)}\w*", re.I) for t in {t.strip() for t in terms if len(t.strip()) >= 4}]
    out, seen = [], set()
    for s in label["sections"]:
        if s["key"] not in sections:
            continue
        for sent in _SENT.split(s["text"]):
            for p in pats:
                m = p.search(sent)
                if m and sent not in seen:
                    seen.add(sent)
                    out.append({"section": s["title"], "text": sent[:600], "match": m.group(0)})
                    break
            if len(out) >= 6:
                return out
    return out
