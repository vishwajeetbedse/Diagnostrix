"""Knowledge-base rationale templates.

Deterministic, pharmacist-grade explanations composed only from knowledge-base
facts. Always available; the AI layer may later rephrase the `rationale`
paragraph, but headline, summary, actions and monitoring stay deterministic.
"""
from __future__ import annotations


def n(v) -> str:
    if v is None:
        return "—"
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    if isinstance(v, int):
        return f"{v:,}"
    return f"{v:,.4f}".rstrip("0").rstrip(".")


KIND = {"Pharmacokinetic": "pharmacokinetic", "Pharmacodynamic": "pharmacodynamic", "Pharmacokinetic + pharmacodynamic": "pharmacokinetic and pharmacodynamic"}
LEVEL_TEXT = {
    "Major": "Major — the combination may be life-threatening or require medical intervention to prevent serious harm",
    "Moderate": "Moderate — the combination may worsen the patient's condition or require a change in therapy",
    "Minor": "Minor — limited clinical effect",
    "Unknown": "Documented, severity not graded",
}


def join_items(items) -> str:
    """English list: [1] → "1", [1, 3] → "1 and 3", [1, 2, 4] → "1, 2 and 4". Used for line numbers in alerts."""
    items = [str(i) for i in items]
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def _drug(drugs: dict, line: int | None) -> dict | None:
    return drugs.get(line) if line is not None else None


def _suggest(d) -> str:
    if d["suggested"] > 0:
        return f"Reduce to ≤ {n(d['suggested'])} mg {d['freq']['label'].lower()} (≤ {n(d['ceiling']['value'])} mg/day)."
    return f"No practical dose at this frequency stays within {n(d['ceiling']['value'])} mg/day — reduce the frequency."


def explain(f: dict, drugs: dict) -> dict:
    d = f["data"]
    t = f["type"]
    kb = _drug(drugs, f["lines"][0] if f["lines"] else None)

    if t == "dose-peds":
        return {
            "headline": "Dose exceeds maximum pediatric weight-based limit",
            "summary": f"{n(d['tdd'])} mg/day ordered · ceiling {n(d['ceiling']['value'])} mg/day · {d['pct']}% of limit",
            "rationale": (
                f"The ordered regimen of {n(d['dose'])} mg {d['freq']['label'].lower()} delivers {n(d['tdd'])} mg/day"
                + (f" ({n(d['mgPerKg'])} mg/kg/day)" if d.get("mgPerKg") is not None else "")
                + f", exceeding the patient-specific ceiling of {n(d['ceiling']['value'])} mg/day ({d['ceiling']['basis']}) by {n(d['excess'])} mg. "
                + (f"The weight-derived ceiling of {n(d['ceiling']['raw'])} mg/day was capped at the adult absolute maximum. " if d["ceiling"]["capped"] else "")
                + f"{kb['toxicity']} Developmental variation in hepatic metabolism and renal clearance makes weight-normalised dosing mandatory in pediatric patients; adult doses must not be extrapolated."
            ),
            "actions": [_suggest(d), "Confirm the dosing weight was measured this encounter rather than estimated.", "Clarify per-dose versus per-day intent with the prescriber — a common transcription error."],
            "monitoring": kb["monitoring"],
        }
    if t == "dose-adult":
        return {
            "headline": "Dose exceeds maximum recommended adult daily limit",
            "summary": f"{n(d['tdd'])} mg/day ordered · maximum {n(d['ceiling']['value'])} mg/day · {d['pct']}% of limit",
            "rationale": f"The ordered regimen of {n(d['dose'])} mg {d['freq']['label'].lower()} delivers {n(d['tdd'])} mg/day, exceeding the maximum recommended therapeutic limit of {n(d['ceiling']['value'])} mg/day by {n(d['excess'])} mg. {kb['toxicity']}",
            "actions": [_suggest(d), "If a protocol-driven supratherapeutic regimen is intended (e.g. loading), document the indication and duration.", "Clarify per-dose versus per-day intent with the prescriber."],
            "monitoring": kb["monitoring"],
        }
    if t == "interaction":
        a, b, mono, glb = d["a"], d["b"], d.get("mono"), d.get("ddinter")
        if mono:
            da, db = drugs.get(f["lines"][0]), drugs.get(f["lines"][1])
            return {
                "headline": f"High-risk {KIND.get(mono['kind'], 'drug')} interaction detected",
                "summary": f"{a['name']} + {b['name']} · {mono['severity']} · {mono['kind']}" + (f" · DDInter {glb['level']}" if glb else ""),
                "rationale": f"Co-prescription of {a['name']} and {b['name']} is classified as {mono['severity'].lower()} in the curated knowledge base. {mono['mechanism']} {mono['effect']}",
                "actions": [mono["management"], "Contact the prescriber to evaluate a therapeutic alternative before dispensing.",
                            "An override requires attending-physician co-signature and a documented monitoring plan." if mono["severity"] == "Contraindicated" else "If continued, document the monitoring plan in the medication record."],
                "monitoring": [x for x in [(da or {}).get("monitoring", [None])[0], (db or {}).get("monitoring", [None])[0]] if x],
            }
        level = glb["level"]
        return {
            "headline": f"{level} drug–drug interaction in global database",
            "summary": f"{a['name']} + {b['name']} · DDInter {level}",
            "rationale": f"The DDInter drug–drug interaction database grades the combination of {a['name']} and {b['name']} as {LEVEL_TEXT.get(level, level)}. The curated knowledge base holds no monograph for this pair, so review the FDA label evidence and real-world report signal below before dispensing.",
            "actions": ["Review the mechanism in the product labelling shown under Evidence.",
                        "Contact the prescriber to evaluate the combination or an alternative." if level == "Major" else "Consider monitoring or dose adjustment; document the rationale if continued."],
            "monitoring": [],
        }
    if t == "age":
        return {
            "headline": "Age-based contraindication",
            "summary": f"{d['drug']['name']} · patient {n(d['age'])} y · minimum age {n(d['minAge'])} y",
            "rationale": f"{d['drug']['name']} is not indicated for patients younger than {n(d['minAge'])} years. {d['note']}",
            "actions": ["Discontinue this order and select an age-appropriate agent.", "Confirm the recorded date of birth is correct."],
            "monitoring": [],
        }
    if t == "duplicate":
        return {
            "headline": "Therapeutic duplication detected",
            "summary": f"{d['drug']['name']} ordered on lines {join_items(f['lines'])}",
            "rationale": f"{d['drug']['name']} appears on {len(f['lines'])} order lines. Concurrent duplicate orders produce additive exposure that bypasses per-line dose-ceiling verification and is a recognised source of cumulative overdose.",
            "actions": ["Consolidate into a single order line with the intended total regimen.", "Confirm whether one line was intended as a different agent."],
            "monitoring": (kb or {}).get("monitoring", [])[:1],
        }
    if t == "data":
        what = {
            "age": ("Patient age is not recorded", "Age determines whether pediatric weight-based or adult absolute limits apply; no dose ceiling can be established without it."),
            "weight": ("Dosing weight is required for a pediatric patient", "Pediatric ceilings are derived from mg/kg/day × actual body weight; verification cannot proceed without a measured weight."),
            "dose": (f"No valid dose entered for {(d.get('drug') or {}).get('name', 'this line')}", "Enter the intended dose per administration in milligrams."),
            "order": ("No medication selected", "Select at least one agent to verify."),
        }[d["missing"]]
        return {"headline": "Verification blocked — incomplete clinical context", "summary": what[0], "rationale": what[1], "actions": ["Complete the missing field and re-run verification."], "monitoring": []}
    if t == "near-ceiling":
        return {
            "headline": "Dose approaching maximum therapeutic limit",
            "summary": f"{n(d['tdd'])} mg/day · {d['pct']}% of {n(d['ceiling']['value'])} mg/day",
            "rationale": f"{d['drug']['name']} {n(d['tdd'])} mg/day lies within the permissible range but at {d['pct']}% of the patient-specific ceiling, leaving little margin for additional doses from PRN orders or combination products.",
            "actions": ["Reconcile all sources of this agent, including PRN and over-the-counter combination products."],
            "monitoring": kb["monitoring"][:1],
        }
    if t == "renal":
        r = d["renal"]
        return {
            "headline": "Renal dose adjustment indicated",
            "summary": f"{r['label']} {n(r['value'])} {r['unit']} · threshold {d['threshold']}",
            "rationale": f"Estimated renal function is below the adjustment threshold for {d['drug']['name']}. {d['note']}",
            "actions": ["Adjust the dose or interval per renal function and reassess with the next creatinine."],
            "monitoring": ["Serum creatinine and urine output"],
        }
    if t == "geriatric":
        g = d["geriatric"]
        return {
            "headline": "Exceeds recommended older-adult ceiling" if g.get("maxDaily") is not None else "Potentially inappropriate in older adults",
            "summary": f"{d['drug']['name']} {n(d['tdd'])} mg/day · older-adult maximum {n(g['maxDaily'])} mg/day" if g.get("maxDaily") is not None else f"{d['drug']['name']} · patient {n(d['age'])} y",
            "rationale": g["note"],
            "actions": ["Consider dose reduction or a safer alternative and document the clinical justification."],
            "monitoring": kb["monitoring"][:1],
        }
    if t == "no-kb":
        return {
            "headline": "No curated dose limit — dose not verified",
            "summary": f"{d['drug']['name']} · {n(d['tdd'])} mg/day ordered",
            "rationale": f"{d['drug']['name']} is not in the pharmacy team's curated formulary, so no maximum daily dose is available to check against. Interaction screening against the global database still applies. Confirm the dose against the product labelling.",
            "actions": ["Verify the dose against the FDA label dosage section shown under Evidence.", "Ask the pharmacy team to add this agent to the curated formulary."],
            "monitoring": [],
        }
    return {"headline": "Clinical alert", "summary": f["rule"], "rationale": "", "actions": [], "monitoring": []}
