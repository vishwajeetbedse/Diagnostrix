"""Backend tests — no model download needed (uses the stub model).
Run from the project folder:  python -m unittest server/test_server.py -v
"""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ["DX_LLM"] = "stub"

import prompts  # noqa: E402
from app import create_app  # noqa: E402
from llm import LocalLLM  # noqa: E402

FACTS = {
    "headline": "Dose exceeds maximum pediatric weight-based limit",
    "severity": "critical",
    "finding": "3,000 mg/day ordered · ceiling 1,500 mg/day · 200% of limit",
    "patient": "6-year-old male, 20 kg, eGFR 120",
    "rationale": "The ordered regimen of 500 mg every 4 h delivers 3,000 mg/day (150 mg/kg/day), exceeding the patient-specific ceiling of 1,500 mg/day. Exposure above this threshold saturates hepatic glucuronidation. Weight-normalised dosing is mandatory.",
    "actions": ["Reduce to ≤ 250 mg every 4 h (≤ 1,500 mg/day)."],
}


class GroundingTests(unittest.TestCase):
    def test_numbers_ignore_enzyme_names(self):
        self.assertEqual(prompts.numbers("CYP2C9 and CYP3A4 inhibition"), set())

    def test_thousands_separators_and_decimals_normalise(self):
        self.assertEqual(prompts.numbers("1,500 mg and 2.0 mg/dL"), {"1500", "2"})

    def test_grounded_output_passes(self):
        out = "The regimen delivers 3,000 mg/day, which is 200% of the 1500 mg/day ceiling for a 20 kg child."
        self.assertEqual(prompts.ungrounded_numbers(out, prompts.facts_text(FACTS)), [])

    def test_invented_figure_is_caught(self):
        out = "Hepatotoxicity occurs in 24% of such cases within 48 hours."
        self.assertEqual(prompts.ungrounded_numbers(out, prompts.facts_text(FACTS)), ["24", "48"])

    def test_parse_lines_strips_bullets(self):
        self.assertEqual(prompts.parse_lines("- A + B — Major\n2) C + D — Minor\n\n"), ["A + B — Major", "C + D — Minor"])


class ApiTests(unittest.TestCase):
    def setUp(self):
        llm = LocalLLM()
        llm.start()
        self.client = create_app(llm).test_client()

    def test_health_reports_stub_ready(self):
        data = self.client.get("/api/health").get_json()
        self.assertEqual(data["state"], "ready")
        self.assertEqual(data["model"], "stub")

    def test_explain_returns_grounded_text(self):
        data = self.client.post("/api/explain", json={"facts": FACTS}).get_json()
        self.assertTrue(data["accepted"], data)
        self.assertIn("3,000 mg/day", data["text"])

    def test_explain_requires_facts(self):
        self.assertEqual(self.client.post("/api/explain", json={}).status_code, 400)

    def test_check_focuses_on_unknown_agents(self):
        data = self.client.post(
            "/api/check",
            json={"medications": ["Dolo 650", "Pan 40"], "focus": ["Pan 40"], "verified": ["Dolo 650 → acetaminophen"], "patient": ""},
        ).get_json()
        self.assertEqual(len(data["lines"]), 1)
        self.assertIn("Pan 40", data["lines"][0])

    def test_check_validates_input(self):
        self.assertEqual(self.client.post("/api/check", json={"medications": []}).status_code, 400)

    def test_server_code_is_not_served(self):
        self.assertEqual(self.client.get("/server/app.py").status_code, 404)
        res = self.client.get("/js/engine.js")
        self.assertEqual(res.status_code, 200)
        res.close()

    def test_model_offline_returns_503(self):
        off = LocalLLM()
        off.mode = "off"
        off.start()
        client = create_app(off).test_client()
        self.assertEqual(client.post("/api/explain", json={"facts": FACTS}).status_code, 503)


if __name__ == "__main__":
    unittest.main()
