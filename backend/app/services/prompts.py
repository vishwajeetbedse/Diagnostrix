"""Prompt templates and safety checks for the Diagnostix AI layer."""
from __future__ import annotations

import re

# ---------------------------------------------------------------- explain
EXPLAIN_SYSTEM = """You are a senior clinical pharmacist writing the rationale section of a medication-safety alert in a hospital order-verification system.
Rules:
- Use ONLY the facts provided. Do not add drugs, doses, numbers, percentages, studies or guidelines that are not in the facts.
- Copy every number exactly as it appears in the facts.
- Write 3 to 5 sentences of plain prose in a formal clinical register. No headings, bullet points, greetings or disclaimers.
- Explain why this finding is dangerous for this specific patient and the mechanism that causes harm."""


def explain_user(facts: dict) -> str:
    actions = "; ".join(facts.get("actions") or [])
    return (
        f"ALERT: {facts.get('headline', '')}\n"
        f"SEVERITY: {facts.get('severity', '')}\n"
        f"FINDING: {facts.get('finding', '')}\n"
        f"PATIENT: {facts.get('patient', '')}\n"
        f"KNOWLEDGE BASE RATIONALE: {facts.get('rationale', '')}\n"
        f"RECOMMENDED ACTIONS: {actions}\n\n"
        "Write the clinical rationale for the pharmacist."
    )


def facts_text(facts: dict) -> str:
    parts = [str(facts.get(k, "")) for k in ("headline", "severity", "finding", "patient", "rationale")]
    parts.extend(str(a) for a in facts.get("actions") or [])
    return "\n".join(parts)


# ------------------------------------------------------------------ screen
SCREEN_SYSTEM = """You are a clinical pharmacist assistant performing a drug-drug interaction SCREEN on a medication list.
Rules:
- Resolve brand names to their active ingredients only when you are confident. If you do not recognise a name, write "<name> — Unrecognised — verify with a pharmacist".
- Report only interactions you are confident are documented. Never invent an interaction. If unsure, say so.
- One line per finding, in this exact format:
  <drug A> + <drug B> — <Major | Moderate | Minor> — <mechanism in one clause> — <recommended action>
- If no significant interactions are expected, write exactly: No clinically significant interactions identified.
- At most 6 lines. No introduction or closing remarks."""


def screen_user(medications: list[str], verified: list[str], focus: list[str], patient: str) -> str:
    return (
        f"Medications: {', '.join(medications)}\n"
        f"Patient: {patient or 'not specified'}\n"
        f"Already verified by the knowledge base (do not repeat these): {', '.join(verified) or 'none'}\n"
        f"Focus on pairs involving: {', '.join(focus)}"
    )


def parse_lines(text: str, limit: int = 6) -> list[str]:
    lines = []
    for raw in text.splitlines():
        line = re.sub(r"^\s*(?:[-*•]|\d+[.)])\s*", "", raw).strip()
        if line:
            lines.append(line[:400])
    return lines[:limit]


# -------------------------------------------------------------- grounding
# A number counts when it is not glued to a preceding letter or digit, so
# enzyme names such as CYP2C9 or CYP3A4 are ignored.
_NUM = re.compile(r"(?<![A-Za-z0-9.])\d[\d,]*(?:\.\d+)?")


def _norm(token: str) -> str:
    token = token.replace(",", "").rstrip(".")
    try:
        value = float(token)
    except ValueError:
        return token
    return f"{value:g}"


def numbers(text: str) -> set[str]:
    return {_norm(m) for m in _NUM.findall(text or "") if _norm(m)}


def ungrounded_numbers(output: str, source: str) -> list[str]:
    """Numbers in the model output that do not appear anywhere in the source facts."""
    return sorted(numbers(output) - numbers(source), key=lambda s: float(s) if s.replace(".", "", 1).isdigit() else 0)


def grounding_report(output: str, source: str) -> dict:
    """Every figure in the output, in order of appearance, marked grounded or not.

    Returned to the UI so the clinician can see exactly which numbers were
    checked and which one (if any) caused a rejection.
    """
    known = numbers(source)
    seen: list[str] = []
    for m in _NUM.findall(output or ""):
        v = _norm(m)
        if v and v not in seen:
            seen.append(v)
    rows = [{"value": v, "grounded": v in known} for v in seen]
    return {"figures": rows, "ungrounded": [r["value"] for r in rows if not r["grounded"]],
            "passed": all(r["grounded"] for r in rows), "factFigures": len(known)}


def judge(raw: str, source: str) -> dict:
    """The single accept/reject decision for model output (used by /ai/explain and /ai/grounding-check).

    Rejects text that is too short to be a rationale, or that contains any
    figure absent from the verified facts. Rejected text is never shown as the
    rationale; the UI falls back to the knowledge-base text.
    """
    text = clean_prose(raw)
    report = grounding_report(text, source)
    if len(text) < 40:
        return {"accepted": False, "reason": "Model returned no usable text.", "candidate": text, "grounding": report}
    if report["ungrounded"]:
        return {"accepted": False, "reason": f"It contained figures not in the verified facts ({', '.join(report['ungrounded'])}).",
                "candidate": text, "grounding": report}
    return {"accepted": True, "candidate": text, "grounding": report}


def inject_fabricated_figure(text: str, source: str) -> dict:
    """Training demo: alter one figure so it no longer matches the facts.

    Replaces the largest figure in the text (usually a dose or daily total, the
    most dangerous thing to get wrong) with a multiple of it that appears
    nowhere in the facts or the text, or appends a dosing sentence if the text
    has no numbers. The altered text then goes through judge() unchanged, so
    the rejection shown is the real check, not a canned result.
    """
    known = numbers(source) | numbers(text)
    def size(match) -> float:
        try:
            return float(_norm(match.group().rstrip(",")))
        except ValueError:
            return 0.0

    m = max(_NUM.finditer(text or ""), key=size, default=None)
    if m:
        token = m.group().rstrip(",")  # "3,000, which…" — keep the sentence's own comma
        try:
            base = float(_norm(token))
        except ValueError:
            base = 1.0
        for factor in (3, 7, 11, 13, 17):
            value = base * factor if base else factor
            if _norm(f"{value:g}") not in known:
                break
        new = f"{int(value):,}" if float(value).is_integer() else f"{value:g}"
        end = m.start() + len(token)
        return {"text": text[:m.start()] + new + text[end:], "from": token, "to": new}
    value = next(v for v in range(37, 10_000, 4) if str(v) not in known)
    return {"text": f"{text.rstrip()} Reduce the dose to {value} mg.", "from": None, "to": str(value)}


def clean_prose(text: str, max_chars: int = 1400) -> str:
    text = re.sub(r"[*#`]+", "", text)  # strip markdown the UI would show literally
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_chars]
