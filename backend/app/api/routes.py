"""REST API (v1). Interactive documentation is served at /docs."""
from __future__ import annotations

import asyncio
import sqlite3
import time

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator

from .. import __version__
from ..core import engine
from ..core.rationale import n as num
from ..services import prompts
from ..sources.http import SourceUnavailable

router = APIRouter(prefix="/api/v1")


def C(request: Request):
    return request.app.state.container


# ----------------------------------------------------------------- models
class Patient(BaseModel):
    name: str | None = None
    mrn: str | None = None
    age: float | None = Field(None, ge=0, le=130)
    sex: str | None = Field(None, pattern="^[MF]$")
    weight: float | None = Field(None, gt=0, le=400)
    height: float | None = Field(None, gt=0, le=260)
    scr: float | None = Field(None, gt=0, le=20)


class PatientRecord(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    mrn: str | None = Field(None, max_length=40)
    age: float | None = Field(None, ge=0, le=130)
    sex: str | None = Field(None, pattern="^[MF]$")
    weight: float | None = Field(None, gt=0, le=400)
    height: float | None = Field(None, gt=0, le=260)
    scr: float | None = Field(None, gt=0, le=20)


class PatientPatch(PatientRecord):
    name: str | None = Field(None, min_length=1, max_length=120)


MAX_ORDER_LINES = 15


class OrderLine(BaseModel):
    line: int = Field(ge=1)
    name: str = Field(max_length=120)
    dose: float | None = None
    freqId: str = "daily"


class VerifyRequest(BaseModel):
    patient: Patient
    orders: list[OrderLine] = Field(max_length=MAX_ORDER_LINES)
    patientId: int | None = None
    record: bool = False

    @field_validator("orders")
    @classmethod
    def _unique_lines(cls, v: list[OrderLine]):
        """The engine keys per-line results by line number; duplicates would silently overwrite each other."""
        if len({o.line for o in v}) != len(v):
            raise ValueError("order line numbers must be unique")
        return v


class ScreenRequest(BaseModel):
    entries: list[str] = Field(min_length=1, max_length=12)


class AuditEvent(BaseModel):
    event: str = Field(max_length=40)
    ref: str = Field("", max_length=40)
    payload: dict = {}


class ExplainRequest(BaseModel):
    facts: dict


class GroundingCheckRequest(BaseModel):
    facts: dict
    output: str = Field(max_length=4000)
    inject: bool = False  # training demo: alter one figure before checking


# ----------------------------------------------------------------- system
@router.get("/system/health", tags=["system"])
async def health(request: Request):
    c = C(request)
    fh = {k: {"ok": v.ok, "failed": v.failed, "lastError": v.last_error, "lastOk": v.last_ok, "latencyMs": v.last_latency_ms, "circuitOpen": v.circuit_open}
          for k, v in c.fetcher.health.items()}
    return {
        "version": __version__,
        "mode": c.settings.sources,
        "openfdaKey": bool(c.settings.openfda_key),
        "formulary": {"version": c.kb.version, "drugs": len(c.kb.drugs), "integrity": c.kb.integrity()},
        "ddinter": c.ddinter.meta(),
        "rxnormNames": len(c.rx_names),
        "sources": fh,
        "cache": c.cache.stats(),
        "ai": c.llm.info(),
        "audit": {"entries": len(c.audit.list(100000))},
    }


@router.get("/formulary", tags=["knowledge base"])
async def formulary(request: Request):
    kb = C(request).kb
    return {"version": kb.version, "note": kb.note, "drugs": kb.drugs, "monographs": kb.monographs,
            "combinations": kb.combinations, "frequencies": kb.frequencies, "integrity": kb.integrity()}


# ------------------------------------------------------------------ drugs
@router.get("/drugs/search", tags=["drugs"])
async def search(request: Request, q: str = Query(min_length=1, max_length=80)):
    return {"query": q, "results": C(request).search(q)}


@router.get("/drugs/resolve", tags=["drugs"])
async def resolve(request: Request, q: str = Query(min_length=1, max_length=120)):
    return await C(request).resolver.resolve(q)


@router.get("/drugs/{name}/profile", tags=["drugs"])
async def drug_profile(request: Request, name: str):
    c = C(request)
    r = await c.resolver.resolve(name)
    ingredient = r["ingredients"][0] if r["ingredients"] else name.lower()
    return {"resolution": r, **(await c.evidence.drug(ingredient))}


@router.get("/drugs/{name}/faers", tags=["real-world evidence"])
async def drug_faers(request: Request, name: str):
    return await C(request).evidence.faers(name.lower())


# ---------------------------------------------------------------- patients
def _save(fn):
    """Run a patient write, turning the MRN UNIQUE-constraint violation into a 409 the UI can show."""
    try:
        return fn()
    except sqlite3.IntegrityError:
        raise HTTPException(409, "A patient with this MRN already exists")


@router.post("/patients", tags=["patients"], status_code=201)
async def patient_create(request: Request, body: PatientRecord):
    """Register a patient. MRN is optional but must be unique when given."""
    return _save(lambda: C(request).patients.create(body.model_dump()))


@router.get("/patients", tags=["patients"])
async def patient_list(request: Request, q: str = Query("", max_length=80), limit: int = Query(100, ge=1, le=500)):
    """List patients, most recently updated first; `q` matches a substring of name or MRN."""
    return {"patients": C(request).patients.list(q, limit)}


def _patient_or_404(c, pid: int) -> dict:
    p = c.patients.get(pid)
    if not p:
        raise HTTPException(404, "Patient not found")
    return p


@router.get("/patients/{pid}", tags=["patients"])
async def patient_get(request: Request, pid: int):
    """Fetch one patient record."""
    return _patient_or_404(C(request), pid)


@router.patch("/patients/{pid}", tags=["patients"])
async def patient_update(request: Request, pid: int, body: PatientPatch):
    """Partial update: only fields present in the body change. Past audit entries are not rewritten."""
    c = C(request)
    _patient_or_404(c, pid)
    patch = body.model_dump(exclude_unset=True)
    if "name" in patch and not patch["name"]:
        raise HTTPException(422, "name cannot be empty")
    return _save(lambda: c.patients.update(pid, patch))


@router.delete("/patients/{pid}", tags=["patients"], status_code=204)
async def patient_delete(request: Request, pid: int):
    """Delete a patient record. Audit entries that reference its id are kept (the ledger is append-only)."""
    if not C(request).patients.delete(pid):
        raise HTTPException(404, "Patient not found")


# ------------------------------------------------------------ verification
async def _normalise_orders(c, orders: list[dict]) -> list[dict]:
    """Map brand names only RxNorm knows (e.g. Zocor) to their single active ingredient."""
    async def one(o):
        name = o["name"].strip()
        if len(name) < 4 or c.resolver.local_id(name) or c.ddinter.known(name):
            return o
        try:
            r = await asyncio.wait_for(c.resolver.resolve(name), timeout=2.5)
        except (asyncio.TimeoutError, SourceUnavailable):
            return o
        if r.get("via") == "rxnorm" and len(r["ingredients"]) == 1:
            return {**o, "name": r["ingredients"][0], "input": name}
        return o

    return list(await asyncio.gather(*(one(o) for o in orders)))


@router.post("/verify", tags=["verification"])
async def verify(request: Request, body: VerifyRequest):
    """Verify an order of up to 15 lines. With `record`, write it to the audit ledger (linked to `patientId` if given)."""
    c = C(request)
    if body.patientId is not None:
        _patient_or_404(c, body.patientId)
    orders = await _normalise_orders(c, [o.model_dump() for o in body.orders])
    t0 = time.perf_counter()
    result = engine.verify(
        body.patient.model_dump(), orders, c.kb,
        resolve_local=c.resolver.local_id,
        ddi=c.ddinter.lookup if c.ddinter.available else None,
    )
    result["engineMs"] = round((time.perf_counter() - t0) * 1000, 2)
    result["sources"] = {"curated": c.kb.version, "ddinter": c.ddinter.meta()}
    if body.record:
        c.audit.append("verification", result["id"], {
            "patientId": body.patientId,
            "patient": {k: v for k, v in body.patient.model_dump().items() if k in ("mrn", "age", "weight")},
            "orders": [f"{l['drug']['name']} {num(l['dose'])} mg {l['freq']['label'].lower()}" for l in result["lines"]],
            "status": result["status"], "counts": result["counts"],
            "rules": [f["rule"] for f in result["findings"]],
        })
    return result


# ---------------------------------------------------------------- evidence
@router.get("/evidence/pair", tags=["evidence"])
async def pair(request: Request, a: str, b: str):
    return await C(request).evidence.pair(a.lower(), b.lower())


@router.get("/signals/pair", tags=["real-world evidence"])
async def signal(request: Request, a: str, b: str):
    return await C(request).evidence.signal(a.lower(), b.lower())


@router.post("/screen", tags=["evidence"])
async def screen(request: Request, body: ScreenRequest):
    c = C(request)
    result = await c.evidence.screen([e.strip() for e in body.entries if e.strip()])
    c.audit.append("list-screen", "", {"entries": body.entries, "findings": len(result["findings"])})
    return result


# ------------------------------------------------------------------- audit
@router.get("/audit", tags=["audit"])
async def audit_list(request: Request, limit: int = 200):
    return {"entries": C(request).audit.list(limit)}


@router.post("/audit", tags=["audit"])
async def audit_append(request: Request, body: AuditEvent):
    allowed = {"override", "acknowledge", "dose-change", "sign", "ai-rationale", "ai-rejected"}
    if body.event not in allowed:
        raise HTTPException(400, f"event must be one of {sorted(allowed)}")
    return C(request).audit.append(body.event, body.ref, body.payload)


@router.get("/audit/verify", tags=["audit"])
async def audit_verify(request: Request):
    return C(request).audit.verify()


@router.post("/audit/tamper-demo", tags=["audit"])
async def audit_tamper(request: Request):
    """Training environment only — edits the first entry directly so verification can be shown to fail."""
    return C(request).audit.tamper_demo()


# ---------------------------------------------------------------------- AI
def _facts(body_facts: dict) -> dict:
    facts = {k: (v[:10] if isinstance(v, list) else str(v)[:4000]) for k, v in body_facts.items()}
    if not facts.get("rationale"):
        raise HTTPException(400, "facts.rationale is required")
    return facts


@router.post("/ai/explain", tags=["ai"])
async def ai_explain(request: Request, body: ExplainRequest):
    """Ask the local model to reword a finding's rationale, then run the grounding check.

    Returns the prompt the model saw, its raw output and the per-figure
    grounding report whether or not the text was accepted, so the UI can show
    the safety check. `text` is present only when accepted.
    """
    c = C(request)
    facts = _facts(body.facts)
    if not c.llm.ready:
        raise HTTPException(503, f"Model not ready ({c.llm.state})")
    t0 = time.time()
    prompt = prompts.explain_user(facts)
    raw = await asyncio.to_thread(c.llm.generate, prompts.EXPLAIN_SYSTEM, prompt, 220)
    verdict = prompts.judge(raw, prompts.facts_text(facts))
    out = {"accepted": verdict["accepted"], "model": c.llm.info()["model"], "latencyMs": int((time.time() - t0) * 1000),
           "prompt": prompt, "raw": raw, "candidate": verdict["candidate"], "grounding": verdict["grounding"]}
    if verdict["accepted"]:
        out["text"] = verdict["candidate"]
    else:
        out["reason"] = verdict["reason"]
    return out


@router.post("/ai/grounding-check", tags=["ai"])
async def ai_grounding_check(body: GroundingCheckRequest):
    """Run the same accept/reject check /ai/explain applies to model output, on any text.

    Needs no model, so it works with the AI off. With `inject`, one figure is
    first altered so it no longer matches the facts: a repeatable way to show
    a rejection and the knowledge-base fallback during training or a demo.
    """
    facts = _facts(body.facts)
    source = prompts.facts_text(facts)
    output, injected = body.output, None
    if body.inject:
        injected = prompts.inject_fabricated_figure(output, source)
        output = injected["text"]
    verdict = prompts.judge(output, source)
    return {**verdict, "checked": output, "injected": injected, "facts": source}


@router.post("/ai/screen", tags=["ai"])
async def ai_screen(request: Request, body: dict):
    c = C(request)
    meds = [str(m)[:60] for m in body.get("medications", []) if str(m).strip()][:12]
    focus = [str(m)[:60] for m in body.get("focus", []) if str(m).strip()][:12]
    if not meds or not focus:
        raise HTTPException(400, "Provide medications and focus")
    if not c.llm.ready:
        raise HTTPException(503, f"Model not ready ({c.llm.state})")
    t0 = time.time()
    raw = await asyncio.to_thread(c.llm.generate, prompts.SCREEN_SYSTEM,
                                  prompts.screen_user(meds, [str(v)[:120] for v in body.get("verified", [])], focus, str(body.get("patient", ""))[:200]), 320)
    return {"lines": prompts.parse_lines(raw), "model": c.llm.info()["model"], "latencyMs": int((time.time() - t0) * 1000)}
