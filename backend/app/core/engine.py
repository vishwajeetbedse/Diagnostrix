"""Verification rules engine — the single source of truth for whether an alert fires.

Deterministic and local: it reads only the curated formulary and the local
DDInter interaction table, so a verification takes milliseconds and works
offline. Network evidence (FDA labels, FAERS) is fetched separately and never
decides an alert.

Rules
  DATA-01      incomplete patient context or dose                     critical · hard stop
  DOSE-PED-01  age < 18: daily dose > mg/kg/day × weight (≤ adult max) critical
  DOSE-ADT-01  age ≥ 18: daily dose > adult absolute maximum          critical
  DDI-KB-01    pair contraindicated in the curated knowledge base      critical
  DDI-GLB-01   pair rated Major in DDInter (global database)           critical
  DDI-GLB-02   pair rated Moderate in DDInter                          advisory
  DUP-01       same ingredient on more than one line                   critical · hard stop
  AGE-01       patient younger than the agent's minimum age            critical · hard stop
  ADV-CEIL-01  daily dose ≥ 90% of ceiling                             advisory
  ADV-RENAL-01 renal function below the agent's threshold              advisory
  ADV-GER-01   older-adult (Beers) caution                             advisory
  ADV-NOKB-01  agent has no curated dose limit — dose not checked      advisory

DDI-* rules run on every pair of order lines (itertools.combinations);
DUP-01 groups lines by ingredient.
"""
from __future__ import annotations

import math
import secrets
import time
from itertools import combinations
from datetime import datetime, timezone
from typing import Callable

from . import clinical_math as M
from .formulary import Formulary
from .rationale import explain, join_items as _join

NEAR_CEILING_PCT = 90
HARD_STOPS = {"data", "age", "duplicate"}

# (ingredient_a, ingredient_b) -> {"level": "Major"|"Moderate"|"Minor"|"Unknown", ...} or None
DDILookup = Callable[[str, str], "dict | None"]


def floor_to_step(value: float, step: float) -> float:
    return round(math.floor(value / step + 1e-9) * step, 4)


def daily_ceiling(drug: dict, patient: dict) -> dict | None:
    age, weight = patient.get("age"), patient.get("weight")
    if not isinstance(age, (int, float)):
        return None
    if age < 18:
        if not isinstance(weight, (int, float)) or weight <= 0:
            return None
        raw = drug["pedsMaxMgPerKgDay"] * weight
        capped = raw > drug["adultMaxDaily"]
        return {
            "value": round(drug["adultMaxDaily"] if capped else raw, 4),
            "raw": round(raw, 4),
            "capped": capped,
            "rule": "pediatric",
            "basis": f"{_n(drug['pedsMaxMgPerKgDay'])} mg/kg/day × {_n(weight)} kg",
        }
    return {"value": drug["adultMaxDaily"], "raw": drug["adultMaxDaily"], "capped": False, "rule": "adult", "basis": "adult absolute maximum"}


def _n(v) -> str:
    if v is None:
        return "—"
    return f"{v:,.4f}".rstrip("0").rstrip(".")


def _ref() -> str:
    return "VR-" + format(int(time.time() * 1000) % 36**5, "X").rjust(5, "0")[-5:] + secrets.token_hex(1).upper()


def _slim(drug: dict | None, name: str) -> dict:
    if drug:
        return {"id": drug["id"], "name": drug["name"], "curated": True}
    return {"id": name.lower(), "name": name[:1].upper() + name[1:], "curated": False}


def verify(patient: dict, orders: list[dict], kb: Formulary, resolve_local: Callable[[str], str | None], ddi: DDILookup | None = None) -> dict:
    """Run every rule against one order and return findings, per-line results and a check list.

    patient: {age, weight, height, sex, scr}
    orders:  [{line, name, dose, freqId}]  any number of lines; name = generic/brand as entered;
             line numbers must be unique (the API enforces this)
    resolve_local(name) -> curated drug id or None
    ddi(a, b) -> DDInter record or None

    Per-line rules (dose ceiling, age, renal, geriatric) run once per line.
    Duplication is grouped by ingredient, so the same drug on three lines is
    one DUP-01 naming all three rather than three pairwise alerts. Interaction
    rules run on every distinct pair (n·(n−1)/2 lookups — trivial at the
    15-line API limit), because a dangerous combination can sit on any two
    lines, not just the first two.
    """
    prof = M.profile(patient)
    findings: list[dict] = []
    checks: list[dict] = []

    def add(rule, ftype, severity, lines, data):
        findings.append({"id": f"{rule}:{'-'.join(map(str, lines))}", "rule": rule, "type": ftype, "severity": severity, "lines": lines, "data": data})

    active = [o for o in (orders or []) if o and (o.get("name") or "").strip()]
    age = patient.get("age")
    age_known = isinstance(age, (int, float)) and 0 <= age <= 130
    weight = patient.get("weight")

    if not age_known:
        add("DATA-01", "data", "critical", [], {"missing": "age"})
    pediatric = age_known and age < 18
    if pediatric and not (isinstance(weight, (int, float)) and weight > 0):
        add("DATA-01", "data", "critical", [], {"missing": "weight"})
    if not active:
        add("DATA-01", "data", "critical", [], {"missing": "order"})

    lines = []
    for o in active:
        name = o["name"].strip()
        drug_id = resolve_local(name)
        drug = kb.drug(drug_id) if drug_id else None
        freq = kb.frequency(o.get("freqId") or "daily")
        dose = o.get("dose")
        dose_ok = isinstance(dose, (int, float)) and math.isfinite(dose) and dose > 0
        tdd = round(dose * freq["perDay"], 4) if dose_ok else None
        ceiling = daily_ceiling(drug, patient) if (drug and age_known) else None
        pct = round(tdd / ceiling["value"] * 100) if (ceiling and tdd is not None) else None
        mgkg = round(tdd / weight, 2) if (tdd is not None and isinstance(weight, (int, float)) and weight > 0) else None
        ingredient = drug["name"] if drug else name
        line = {
            "line": o["line"], "input": o.get("input") or name, "drug": _slim(drug, ingredient), "ingredient": ingredient.lower(),
            "freq": freq, "dose": dose if dose_ok else None, "tdd": tdd, "ceiling": ceiling, "pct": pct, "mgPerKg": mgkg,
        }
        lines.append((line, drug))
        label = f"Dose ceiling · line {o['line']} ({line['drug']['name']})"

        if not dose_ok:
            add("DATA-01", "data", "critical", [o["line"]], {"missing": "dose", "drug": line["drug"]})
            checks.append({"label": label, "result": "fail", "detail": "No valid dose entered"})
            continue
        if not drug:
            add("ADV-NOKB-01", "no-kb", "advisory", [o["line"]], {"drug": line["drug"], "tdd": tdd})
            checks.append({"label": label, "result": "n/a", "detail": "No curated dose limit for this agent"})
            continue
        if not ceiling:
            checks.append({"label": label, "result": "fail", "detail": "Ceiling not computable — patient context incomplete"})
            continue

        suggested = floor_to_step(ceiling["value"] / freq["perDay"], drug["doseStep"])
        base = {"drug": line["drug"], "freq": freq, "dose": dose, "tdd": tdd, "ceiling": ceiling, "pct": pct, "mgPerKg": mgkg}
        if tdd > ceiling["value"]:
            rule = "DOSE-PED-01" if ceiling["rule"] == "pediatric" else "DOSE-ADT-01"
            add(rule, "dose-peds" if ceiling["rule"] == "pediatric" else "dose-adult", "critical", [o["line"]],
                {**base, "excess": round(tdd - ceiling["value"], 4), "suggested": suggested, "weight": weight})
            checks.append({"label": label, "result": "fail", "detail": f"{pct}% of {ceiling['rule']} maximum"})
        elif pct >= NEAR_CEILING_PCT:
            add("ADV-CEIL-01", "near-ceiling", "advisory", [o["line"]], base)
            checks.append({"label": label, "result": "advisory", "detail": f"{pct}% of {ceiling['rule']} maximum"})
        else:
            checks.append({"label": label, "result": "pass", "detail": f"{pct}% of {ceiling['rule']} maximum"})

    # ---- age restriction
    if age_known and lines:
        fail = False
        for line, drug in lines:
            if drug and drug.get("minAgeYears") is not None and age < drug["minAgeYears"]:
                fail = True
                add("AGE-01", "age", "critical", [line["line"]], {"drug": line["drug"], "age": age, "minAge": drug["minAgeYears"], "note": drug.get("minAgeNote", "")})
        checks.append({"label": "Age restriction screen", "result": "fail" if fail else "pass", "detail": "Agent below minimum age" if fail else "No age-restricted agents"})

    # ---- duplication (grouped by ingredient) and interaction (every distinct pair)
    # One summary check each: the worst pair result decides pass/advisory/fail,
    # and the detail names every flagged pair so the pharmacist sees which two drugs.
    if len(lines) >= 2:
        groups: dict[str, list[dict]] = {}
        for line, _ in lines:
            groups.setdefault(line["ingredient"], []).append(line)
        dups = [g for g in groups.values() if len(g) > 1]
        for g in dups:
            add("DUP-01", "duplicate", "critical", [x["line"] for x in g], {"drug": g[0]["drug"]})
        checks.append({"label": "Therapeutic duplication", "result": "fail" if dups else "pass",
                       "detail": "; ".join(f"{g[0]['drug']['name']} on lines {_join([x['line'] for x in g])}" for g in dups) if dups else "Distinct agents"})

        rank = {"pass": 0, "advisory": 1, "fail": 2}
        worst, flagged, notes, screened = "pass", [], [], 0
        for (a, da), (b, db) in combinations(lines, 2):
            if a["ingredient"] == b["ingredient"]:
                continue  # screened as duplication
            screened += 1
            pair = [a["line"], b["line"]]
            names = f"{a['drug']['name']} + {b['drug']['name']}"
            glb = ddi(a["ingredient"], b["ingredient"]) if ddi else None
            if da and db and kb.contraindicated(da["id"], db["id"]):
                mono = kb.monograph(da["id"], db["id"])
                add("DDI-KB-01", "interaction", "critical", pair, {"a": a["drug"], "b": b["drug"], "mono": mono, "ddinter": glb, "source": "kb"})
                result, detail = "fail", f"Curated KB: {mono['severity']}" + (f" · DDInter: {glb['level']}" if glb else "")
            elif glb and glb["level"] == "Major":
                add("DDI-GLB-01", "interaction", "critical", pair, {"a": a["drug"], "b": b["drug"], "mono": None, "ddinter": glb, "source": "ddinter"})
                result, detail = "fail", "DDInter: Major"
            elif glb and glb["level"] == "Moderate":
                add("DDI-GLB-02", "interaction", "advisory", pair, {"a": a["drug"], "b": b["drug"], "mono": None, "ddinter": glb, "source": "ddinter"})
                result, detail = "advisory", "DDInter: Moderate"
            else:
                result, detail = "pass", f"DDInter: {glb['level']}" if glb else ("No severe interaction in curated KB or DDInter" if ddi else "No severe interaction in curated KB")
            notes.append(detail)
            if result != "pass":
                flagged.append(f"{names}: {detail}")
            if rank[result] > rank[worst]:
                worst = result
        if not screened:
            checks.append({"label": "Drug–drug interaction screen", "result": "n/a", "detail": "Same agent — screened as duplication"})
        elif screened == 1:
            checks.append({"label": "Drug–drug interaction screen", "result": worst, "detail": notes[0]})
        else:
            checks.append({"label": "Drug–drug interaction screen", "result": worst,
                           "detail": "; ".join(flagged) if flagged else f"{screened} pairs · no severe interaction found"})
    elif len(lines) == 1:
        checks.append({"label": "Drug–drug interaction screen", "result": "n/a", "detail": "Single agent ordered"})

    # ---- advisories
    if lines:
        if prof["renal"]:
            flagged = False
            for line, drug in lines:
                if drug and drug.get("renal") and prof["renal"]["value"] < drug["renal"]["threshold"]:
                    flagged = True
                    add("ADV-RENAL-01", "renal", "advisory", [line["line"]], {"drug": line["drug"], "renal": prof["renal"], "threshold": drug["renal"]["threshold"], "note": drug["renal"]["note"]})
            r = prof["renal"]
            checks.append({"label": "Renal dose adjustment", "result": "advisory" if flagged else "pass", "detail": f"{r['label']} {r['value']} {r['unit']}"})
        else:
            checks.append({"label": "Renal dose adjustment", "result": "n/a", "detail": "Serum creatinine not recorded"})
        if age_known and age >= 65:
            flagged = False
            for line, drug in lines:
                g = drug.get("geriatric") if drug else None
                if not g or age < g["age"] or line["tdd"] is None:
                    continue
                if g.get("maxDaily") is None or line["tdd"] > g["maxDaily"]:
                    flagged = True
                    add("ADV-GER-01", "geriatric", "advisory", [line["line"]], {"drug": line["drug"], "tdd": line["tdd"], "geriatric": g, "age": age})
            checks.append({"label": "Older-adult (Beers) screen", "result": "advisory" if flagged else "pass", "detail": "Caution flagged" if flagged else "No potentially inappropriate agents"})

    critical = [f for f in findings if f["severity"] == "critical"]
    advisory = [f for f in findings if f["severity"] == "advisory"]
    ordered = critical + advisory
    drugs = {line["line"]: drug for line, drug in lines}
    for f in ordered:
        f["hardStop"] = f["severity"] == "critical" and f["type"] in HARD_STOPS
        f.update(explain(f, drugs))

    return {
        "id": _ref(),
        "at": datetime.now(timezone.utc).isoformat(),
        "kbVersion": kb.version,
        "status": "critical" if critical else "advisory" if advisory else "pass",
        "counts": {"critical": len(critical), "advisory": len(advisory)},
        "findings": ordered,
        "lines": [line for line, _ in lines],
        "checks": checks,
        "profile": prof,
    }
