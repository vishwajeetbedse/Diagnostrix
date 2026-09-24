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


def clean_prose(text: str, max_chars: int = 1400) -> str:
    text = re.sub(r"[*#`]+", "", text)  # strip markdown the UI would show literally
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_chars]
