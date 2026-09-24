"""Rules-engine tests: dose ceilings, interactions across every order pair, duplication, hard stops, rationale coverage."""
from backend.app.core import clinical_math as M
from backend.app.core import engine

CHILD = {"age": 6, "weight": 20, "height": 116, "sex": "M", "scr": 0.4}
ADULT = {"age": 45, "weight": 70, "height": 165, "sex": "F", "scr": 0.9}


def run(c, patient, *orders):
    lines = [{"line": i + 1, "name": o[0], "dose": o[1], "freqId": o[2]} for i, o in enumerate(orders)]
    return engine.verify(patient, lines, c.kb, c.resolver.local_id, c.ddinter.lookup)


def find(result, rule):
    return next((f for f in result["findings"] if f["rule"] == rule), None)


def test_formulary_integrity(container):
    assert len(container.kb.drugs) >= 5
    assert container.kb.integrity()["ok"]


def test_clinical_math():
    assert M.bmi(70, 175, 30)["value"] == 22.9
    assert M.bsa(70, 175)["value"] == 1.84
    assert M.renal(45, 70, 165, "F", 0.9)["value"] == 87
    assert M.age_band(17.9)["pediatric"] is True and M.age_band(18)["pediatric"] is False


def test_pediatric_overdose(container):
    r = run(container, CHILD, ("acetaminophen", 500, "q4h"))
    f = find(r, "DOSE-PED-01")
    assert f["data"]["ceiling"]["value"] == 1500 and f["data"]["tdd"] == 3000 and f["data"]["pct"] == 200
    assert f["data"]["suggested"] == 250
    assert f["headline"] == "Dose exceeds maximum pediatric weight-based limit"
    assert r["status"] == "critical"


def test_brand_name_resolves_to_curated_limits(container):
    r = run(container, CHILD, ("Dolo 650", 500, "q4h"))
    assert find(r, "DOSE-PED-01")


def test_pediatric_ceiling_capped(container):
    r = run(container, {"age": 16, "weight": 90}, ("acetaminophen", 1000, "q4h"))
    assert find(r, "DOSE-PED-01")["data"]["ceiling"]["capped"]


def test_adult_boundary(container):
    at = run(container, ADULT, ("acetaminophen", 1000, "q6h"))
    assert at["counts"]["critical"] == 0 and find(at, "ADV-CEIL-01")
    assert find(run(container, ADULT, ("ibuprofen", 1200, "q8h")), "DOSE-ADT-01")


def test_curated_interaction_both_orders(container):
    for a, b in (("warfarin", "amiodarone"), ("amiodarone", "warfarin")):
        r = run(container, ADULT, (a, 5 if a == "warfarin" else 200, "daily"), (b, 5 if b == "warfarin" else 200, "daily"))
        f = find(r, "DDI-KB-01")
        assert f and f["headline"] == "High-risk pharmacokinetic interaction detected"


def test_global_database_interaction_for_uncurated_drugs(container):
    r = run(container, ADULT, ("simvastatin", 40, "daily"), ("clarithromycin", 500, "q12h"))
    f = find(r, "DDI-GLB-01")
    assert f and f["data"]["ddinter"]["level"] == "Major"
    assert find(r, "ADV-NOKB-01")  # simvastatin has no curated dose limit


def test_moderate_global_interaction_is_advisory(container):
    r = run(container, ADULT, ("warfarin", 5, "daily"), ("omeprazole", 20, "daily"))
    assert find(r, "DDI-GLB-02")["severity"] == "advisory"


def test_clean_order_passes(container):
    r = run(container, ADULT, ("acetaminophen", 650, "q6h"), ("fluconazole", 200, "daily"))
    assert r["status"] == "pass"


def test_hard_stops(container):
    assert find(run(container, {"age": 10, "weight": 32}, ("tramadol", 50, "q6h")), "AGE-01")["hardStop"]
    assert find(run(container, ADULT, ("ibuprofen", 400, "q8h"), ("Brufen", 400, "q8h")), "DUP-01")
    assert find(run(container, {"age": 4}, ("ibuprofen", 100, "q8h")), "DATA-01")["data"]["missing"] == "weight"


def test_every_finding_has_rationale(container):
    r = run(container, {"age": 82, "weight": 58, "height": 168, "sex": "M", "scr": 2.2}, ("digoxin", 0.25, "daily"), ("clarithromycin", 500, "q12h"))
    for f in r["findings"]:
        assert f["headline"] and f["rationale"] and f["actions"], f["rule"]
    assert find(r, "ADV-RENAL-01") and find(r, "ADV-GER-01")


def test_interactions_checked_across_every_pair(container):
    r = run(container, ADULT, ("acetaminophen", 650, "q6h"), ("warfarin", 5, "daily"), ("omeprazole", 20, "daily"), ("amiodarone", 200, "daily"))
    pairs = {(f["rule"], tuple(f["lines"])) for f in r["findings"] if f["type"] == "interaction"}
    assert ("DDI-KB-01", (2, 4)) in pairs      # warfarin + amiodarone, lines 2 and 4
    assert ("DDI-GLB-02", (2, 3)) in pairs     # warfarin + omeprazole, lines 2 and 3
    kb = next(f for f in r["findings"] if f["rule"] == "DDI-KB-01")
    assert {kb["data"]["a"]["name"], kb["data"]["b"]["name"]} == {"Warfarin", "Amiodarone"}
    ddi_check = next(c for c in r["checks"] if c["label"] == "Drug–drug interaction screen")
    assert ddi_check["result"] == "fail" and "Warfarin + Amiodarone" in ddi_check["detail"]


def test_duplicate_detected_on_non_adjacent_lines(container):
    r = run(container, ADULT, ("ibuprofen", 400, "q8h"), ("warfarin", 5, "daily"), ("Brufen", 400, "q8h"))
    dup = find(r, "DUP-01")
    assert dup["lines"] == [1, 3] and dup["hardStop"]
    assert "lines 1 and 3" in dup["summary"]
    # both ibuprofen lines still screened against warfarin
    assert {tuple(f["lines"]) for f in r["findings"] if f["rule"] == "DDI-KB-01"} == {(1, 2), (2, 3)}
