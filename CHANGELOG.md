# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow the backend `__version__` in `backend/app/__init__.py`.

## [2.1.0] — 2026-09-24

Finishing pass: patient records, multi-drug orders, interface redesign, project documentation.

### Added
- **Patient records.** `patients` table (`backend/app/services/patients.py`), `/api/v1/patients` endpoints (create, list with name/MRN search, get, update, delete), and a Patients page. Order verification can select or create a patient inline; the patient id is stored with verification, sign, override, acknowledge and dose-change audit entries.
- **Orders of up to 15 medications** (previously 2). Interaction rules (DDI-KB-01, DDI-GLB-01, DDI-GLB-02) now run on every pair of lines. DUP-01 groups repeated ingredients into one finding that names every line. Findings name both drugs involved.
- "Polypharmacy, four agents" sample case.
- `LICENSE` (Apache 2.0), `DATA-LICENSE.md`, `CONTRIBUTING.md`, this changelog, `.env.example`, and `docs/` screenshots.
- Optional `.env` file in the project folder, read by `backend/app/config.py` on startup.
- **AI transparency.** Rationale text carries a provenance tag ("AI-generated · model · latency" or "Knowledge-base text" with the reason). A "Show AI safety check" panel shows the facts given to the model, its raw output and a per-figure grounding verdict. A live indicator with elapsed time shows while the local model runs (Order verification, Interaction screen). The System page has an "AI and data pipeline" summary and a "Grounding check — try it" demo. The Signal lab names its method (ROR, 95% CI, log/Woolf).
- `POST /api/v1/ai/grounding-check`: runs the same accept/reject decision as `/ai/explain` on any text; `inject: true` first alters one figure (training demo). `/ai/explain` now also returns the prompt, raw output and grounding report.
- Audit event `ai-rejected`, written when AI output fails the grounding check (flagged when simulated).
- GitHub Actions CI: backend tests (Python 3.12) and frontend typecheck and build (Node 22) on every push and pull request.

### Changed
- Interface redesigned for dense, clinical-style reading: order lines are table rows, not cards; flat panels with square corners; a smaller type scale; colour used only for severity and status; restyled selects, checkboxes and number fields; plain page titles.
- The API rejects orders with duplicate line numbers (422).
- The README was rewritten; test count updated (42).

### Fixed
- FAERS panels and the Signal lab failed with `403 Forbidden` when no openFDA API key was set: openFDA refuses keyless requests with `limit` above 999, and the app asked for 1,000. Keyless requests are now capped at 999.

### Removed
- The dose-meter chart, replaced by an inline percentage-of-maximum bar on each order line.

## [2.0.0] — date not recorded

Rebuilt the prototype as a FastAPI backend and a React + TypeScript frontend, split into three layers.

### Added
- **Decision layer:** a deterministic rules engine (12 rules) over a curated formulary and a local import of the DDInter interaction database. It decides every alert and works offline.
- **Evidence layer:** openFDA drug labels, openFDA FAERS adverse-event reports and RxNorm name resolution, with a SQLite response cache and a circuit breaker that serves cached data when a source fails.
- **Explanation layer:** an optional local language model (Qwen2.5) that rewrites the rationale paragraph; output containing figures not in the verified facts is discarded.
- Interaction screen for full medication lists, Drug intelligence, Signal lab (FAERS reporting odds ratios), a hash-chained audit ledger, and a System page.
- Setup and maintenance tools: `import_ddinter`, `doctor`, `warm_cache`; pytest suite on synthetic fixtures.

## [0.1.0] — date not recorded

Initial prototype: a single static page (`index.html`, `js/`, `css/`) with a JavaScript rules engine (9 rules) that checked doses and interactions for two order lines against a small curated knowledge base, plus a small Python server (`server/`) for an optional local AI explanation. Kept in the repository root for reference; not used by the current app.
