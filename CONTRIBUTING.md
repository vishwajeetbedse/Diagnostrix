# Contributing

Diagnostix was built for a hackathon. Issues and pull requests are welcome.

## Set up and run

Run `bash setup.sh` once (see the [README](README.md#setup)). Then, in two terminals:

```bash
# 1. backend on :8000 (activate the venv first: source .venv/Scripts/activate, or .venv/bin/activate)
python -m backend.app.main

# 2. frontend dev server on :5173, forwarding /api to :8000
cd frontend && npm run dev
```

For work that doesn't need live data or the AI model, `DX_SOURCES=offline DX_LLM=off` starts faster and makes no network calls.

## Tests

Run both before opening a pull request. GitHub Actions (`.github/workflows/ci.yml`) runs the same checks, plus a production frontend build, on every push to `main` and every pull request:

```bash
python -m pytest backend/tests -q
cd frontend && npm run typecheck
```

The tests run on synthetic fixtures (`DX_SOURCES=fixtures`, `DX_LLM=stub`), so they need no network and no model download. When you change a rule, add a case to `backend/tests/test_engine.py`. When you change an endpoint, add one to `backend/tests/test_api.py`.

## Code style

There is no enforced formatter. Match the surrounding code:

- **Python:** type hints, `from __future__ import annotations`, a module docstring at the top of every file, and short docstrings that say *why* as well as what.
- **TypeScript:** strict mode (`noUnusedLocals` is on), function components, and a `/** one-line */` comment above each component.
- **CSS:** use the design tokens in `frontend/src/styles/tokens.css`. Colour is for severity and status only; don't add decorative colour.
- **Clinical logic:** only `backend/app/core/engine.py` may decide whether an alert fires. Dose limits and interaction write-ups belong in `backend/data/formulary.json`, not in code.

## Reporting a bug

Open a GitHub issue with:

1. what you did (the drugs, doses and patient values, if relevant);
2. what you expected, and what happened;
3. the output of `python -m backend.tools.doctor`, and your `DX_SOURCES` / `DX_LLM` settings;
4. any error from the browser console or the server log.

**Never include real patient data** in an issue, a test or a commit. Use made-up values.

If you think a rule gives a clinically wrong answer, say which rule (the ID is shown on each finding, e.g. `DDI-KB-01`) and cite the reference you are comparing against.
