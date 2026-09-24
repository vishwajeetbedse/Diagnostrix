"""Clinical calculations. Each result carries value, unit and the formula used."""
from __future__ import annotations

import math


def _valid(v, lo, hi) -> bool:
    return isinstance(v, (int, float)) and math.isfinite(v) and lo <= v <= hi


def rnd(v: float, dp: int = 1) -> float:
    return round(v, dp)


def age_band(age) -> dict:
    if not _valid(age, 0, 130):
        return {"id": "unknown", "label": "Age not recorded", "pediatric": None}
    if age < 28 / 365:
        return {"id": "neonate", "label": "Neonate", "pediatric": True}
    if age < 1:
        return {"id": "infant", "label": "Infant", "pediatric": True}
    if age < 12:
        return {"id": "child", "label": "Child", "pediatric": True}
    if age < 18:
        return {"id": "adolescent", "label": "Adolescent", "pediatric": True}
    if age < 65:
        return {"id": "adult", "label": "Adult", "pediatric": False}
    return {"id": "older", "label": "Older adult", "pediatric": False}


def bmi(weight, height, age):
    if not _valid(weight, 0.3, 400) or not _valid(height, 25, 260):
        return None
    v = weight / (height / 100) ** 2
    if _valid(age, 0, 17.999):
        cat = "Use BMI-for-age percentile"
    elif v < 18.5:
        cat = "Underweight"
    elif v < 25:
        cat = "Normal weight"
    elif v < 30:
        cat = "Overweight"
    else:
        cat = "Obese"
    return {"value": rnd(v, 1), "unit": "kg/m²", "category": cat, "formula": "weight ÷ height²"}


def bsa(weight, height):
    if not _valid(weight, 0.3, 400) or not _valid(height, 25, 260):
        return None
    return {"value": rnd(math.sqrt(height * weight / 3600), 2), "unit": "m²", "formula": "Mosteller √(ht × wt ÷ 3600)"}


def ibw(height, sex, age):
    if not _valid(height, 152.4, 260) or not _valid(age, 18, 130) or sex not in ("M", "F"):
        return None
    base = 50 if sex == "M" else 45.5
    return {"value": rnd(base + 2.3 * (height / 2.54 - 60), 1), "unit": "kg", "formula": f"Devine {base} + 2.3 kg per inch over 5 ft"}


def renal(age, weight, height, sex, scr):
    """Adults: Cockcroft–Gault CrCl. Children ≥ 1 y: bedside Schwartz eGFR."""
    if not _valid(scr, 0.1, 20) or not _valid(age, 0, 130):
        return None
    if age < 18:
        if not _valid(height, 25, 260) or age < 1:
            return None
        return {"value": round(0.413 * height / scr), "unit": "mL/min/1.73 m²", "label": "eGFR", "formula": "Bedside Schwartz 0.413 × ht ÷ SCr"}
    if not _valid(weight, 20, 400) or sex not in ("M", "F"):
        return None
    v = (140 - age) * weight / (72 * scr) * (0.85 if sex == "F" else 1)
    return {"value": round(v), "unit": "mL/min", "label": "CrCl", "formula": "Cockcroft–Gault" + (" × 0.85" if sex == "F" else "")}


def profile(p: dict) -> dict:
    age, weight, height, sex, scr = p.get("age"), p.get("weight"), p.get("height"), p.get("sex"), p.get("scr")
    return {
        "band": age_band(age),
        "bmi": bmi(weight, height, age),
        "bsa": bsa(weight, height),
        "ibw": ibw(height, sex, age),
        "renal": renal(age, weight, height, sex, scr),
    }
