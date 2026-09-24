"""SYNTHETIC test responses for openFDA and RxNorm.

Used only when DX_SOURCES=fixtures (automated tests and offline UI checks).
Counts are generated deterministically from the query text and are NOT real
FAERS data. The UI shows a "test fixtures" banner in this mode.
"""
from __future__ import annotations

import hashlib
import json
from urllib.parse import parse_qs

import httpx

_REACTIONS = ["NAUSEA", "HAEMORRHAGE", "INTERNATIONAL NORMALISED RATIO INCREASED", "DIZZINESS", "BRADYCARDIA", "FATIGUE",
              "HEPATOTOXICITY", "VOMITING", "DYSPNOEA", "RASH", "ACUTE KIDNEY INJURY", "HEADACHE", "FALL", "ANAEMIA",
              "ELECTROCARDIOGRAM QT PROLONGED", "CONFUSIONAL STATE", "DIARRHOEA", "PRURITUS", "SEROTONIN SYNDROME", "TREMOR"]
_COUNTRIES = ["US", "GB", "JP", "FR", "DE", "CA", "IT", "IN", "BR", "ES", "AU", "NL"]


def _h(text: str, mod: int) -> int:
    return int(hashlib.sha256(text.encode()).hexdigest()[:8], 16) % mod


def _total(search: str) -> int:
    if not search:
        return 20_000_000
    parts = search.count(" AND ") + 1
    return max(0, 60_000 // (parts ** 3) + _h(search, 9000))


def _event(params: dict) -> dict:
    search = params.get("search", "")
    field = params.get("count", "")
    total = _total(search)
    if not field:
        return {"meta": {"results": {"total": total}}, "results": [{}]}
    limit = int(params.get("limit", 100))
    if field == "receivedate":
        return {"results": [{"time": f"{y}0101", "count": 200 + _h(search + str(y), 3000) + (y - 2012) * 180} for y in range(2012, 2026)]}
    pool = _COUNTRIES if field.startswith("occurcountry") else _REACTIONS
    rows = sorted(({"term": t, "count": 10 + _h(search + t, max(50, total // 8))} for t in pool), key=lambda r: -r["count"])
    return {"results": rows[:limit]}


def _label(params: dict) -> dict:
    q = params.get("search", "")
    name = q.split(":", 1)[-1].strip('"').lower()
    if name.startswith("zz"):
        return None
    return {"meta": {"results": {"total": 1}}, "results": [{
        "set_id": "00000000-test-fixture-" + name[:8],
        "effective_time": "20250101",
        "openfda": {"generic_name": [name.upper()], "brand_name": [f"{name.title()} (test)"], "manufacturer_name": ["Synthetic Test Labs"],
                    "pharm_class_epc": ["Test Class [EPC]"], "rxcui": ["0000"]},
        "boxed_warning": [f"WARNING: [SYNTHETIC TEST LABEL] {name.title()} can cause serious harm when misused."],
        "drug_interactions": [f"7 DRUG INTERACTIONS [Synthetic test label] Concomitant use with warfarin, amiodarone or NSAIDs may increase the risk of adverse effects. Monitor patients receiving {name} with other agents."],
        "dosage_and_administration": ["2 DOSAGE AND ADMINISTRATION [Synthetic test label] Use the lowest effective dose."],
        "pediatric_use": ["[Synthetic test label] Safety in pediatric patients has not been established."],
    }]}


def _rxnav(path: str, params: dict):
    if path.endswith("/approximateTerm.json"):
        term = params.get("term", "")
        return {"approximateGroup": {"candidate": [] if term.startswith("zz") else [{"rxcui": "9" + str(_h(term, 99999)), "score": "90", "name": term}]}}
    if path.endswith("/properties.json"):
        rx = path.split("/")[-2]
        return {"properties": {"rxcui": rx, "name": f"ingredient{rx[-3:]}", "tty": "IN"}}
    if path.endswith("/displaynames.json"):
        return {"displayTermsList": {"term": ["warfarin", "amoxicillin", "atorvastatin", "metformin", "pantoprazole", "omeprazole"]}}
    return {}


def synthetic_transport() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        params = {k: v[0] for k, v in parse_qs(request.url.query.decode()).items()}
        if request.url.host == "api.fda.gov":
            body = _event(params) if request.url.path.endswith("event.json") else _label(params)
        else:
            body = _rxnav(request.url.path, params)
        if body is None:
            return httpx.Response(404, json={"error": {"code": "NOT_FOUND"}})
        return httpx.Response(200, content=json.dumps(body), headers={"content-type": "application/json"})

    return httpx.MockTransport(handler)
