"""
Diagnostix CDSS — backend server

Serves the web app and adds a local AI layer:
  GET  /api/health    model status (loading / ready / error / disabled)
  POST /api/explain   rewrite an engine finding as clinical prose, with a
                      numeric grounding check against knowledge-base facts
  POST /api/check     free-text interaction screen for agents that are not
                      in the knowledge base (answer is labelled unverified)

The deterministic engine in js/engine.js always decides whether an alert
fires. The model only explains, and anything it cannot ground is discarded.

Run from the project folder:
    python server/app.py
then open http://localhost:8000
"""
from __future__ import annotations

import logging
import os
import sys
import time
from pathlib import Path

from flask import Flask, abort, jsonify, request, send_from_directory

sys.path.insert(0, str(Path(__file__).resolve().parent))
from llm import LocalLLM  # noqa: E402
import prompts  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
STATIC_DIRS = {"css", "js"}
MAX_MEDS = 12
MAX_FIELD = 4000

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s")
log = logging.getLogger("dx.server")


def create_app(llm: LocalLLM | None = None) -> Flask:
    app = Flask(__name__, static_folder=None)
    model = llm or LocalLLM()
    if llm is None:
        model.start()
    app.config["LLM"] = model

    # ------------------------------------------------------------ static UI
    @app.get("/")
    def index():
        return send_from_directory(ROOT, "index.html")

    @app.get("/<path:path>")
    def static_files(path: str):
        top = path.split("/", 1)[0]
        if top not in STATIC_DIRS:  # never serve server code, tests or .env
            abort(404)
        return send_from_directory(ROOT, path)

    # ----------------------------------------------------------------- API
    @app.get("/api/health")
    def health():
        return jsonify(model.info())

    @app.post("/api/explain")
    def explain():
        body = request.get_json(silent=True) or {}
        facts = body.get("facts")
        if not isinstance(facts, dict) or not facts.get("rationale"):
            return jsonify(error="Request must include facts with a rationale."), 400
        facts = {k: _clip(v) for k, v in facts.items()}
        if not model.ready:
            return jsonify(error="Model not ready", state=model.state), 503

        t0 = time.time()
        raw = model.generate(prompts.EXPLAIN_SYSTEM, prompts.explain_user(facts), max_new_tokens=220)
        text = prompts.clean_prose(raw)
        ms = int((time.time() - t0) * 1000)
        info = {"model": model.info()["model"], "latency_ms": ms}

        if len(text) < 40:
            return jsonify(accepted=False, reason="Model returned no usable text.", **info)
        extra = prompts.ungrounded_numbers(text, prompts.facts_text(facts))
        if extra:
            log.warning("Discarded explanation with ungrounded figures %s", extra)
            return jsonify(accepted=False, reason=f"It contained figures not in the knowledge base ({', '.join(extra)}).", **info)
        return jsonify(accepted=True, text=text, **info)

    @app.post("/api/check")
    def check():
        body = request.get_json(silent=True) or {}
        meds = [_clip(m, 60) for m in body.get("medications") or [] if isinstance(m, str) and m.strip()]
        focus = [_clip(m, 60) for m in body.get("focus") or [] if isinstance(m, str) and m.strip()]
        verified = [_clip(m, 120) for m in body.get("verified") or [] if isinstance(m, str)]
        patient = _clip(body.get("patient") or "", 200)
        if not meds or not focus:
            return jsonify(error="Provide medications and at least one agent to focus on."), 400
        if len(meds) > MAX_MEDS:
            return jsonify(error=f"Screen at most {MAX_MEDS} medications at a time."), 400
        if not model.ready:
            return jsonify(error="Model not ready", state=model.state), 503

        t0 = time.time()
        raw = model.generate(prompts.SCREEN_SYSTEM, prompts.screen_user(meds, verified, focus, patient), max_new_tokens=320)
        return jsonify(
            lines=prompts.parse_lines(raw),
            model=model.info()["model"],
            latency_ms=int((time.time() - t0) * 1000),
        )

    @app.errorhandler(RuntimeError)
    def runtime_error(exc):
        log.exception("Generation failed")
        return jsonify(error=str(exc)), 500

    return app


def _clip(value, limit: int = MAX_FIELD):
    if isinstance(value, list):
        return [_clip(v, limit) for v in value[:10]]
    return str(value)[:limit]


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    application = create_app()
    info = application.config["LLM"].info()
    print(f"\n  Diagnostix CDSS  →  http://localhost:{port}")
    print(f"  AI model: {info['model']} ({info['state']})\n")
    application.run(host="127.0.0.1", port=port, threaded=True, debug=False)
