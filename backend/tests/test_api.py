"""HTTP-level tests through FastAPI's TestClient: verification, patients CRUD, audit, evidence, AI guardrail."""
def test_health_and_formulary(client):
    h = client.get("/api/v1/system/health").json()
    assert h["mode"] == "fixtures" and h["ddinter"]["available"] and h["formulary"]["integrity"]["ok"]
    assert len(client.get("/api/v1/formulary").json()["drugs"]) == 10


def test_verify_records_to_audit(client):
    body = {"patient": {"age": 6, "weight": 20, "height": 116, "sex": "M"},
            "orders": [{"line": 1, "name": "Dolo 650", "dose": 500, "freqId": "q4h"}], "record": True}
    r = client.post("/api/v1/verify", json=body).json()
    assert r["status"] == "critical" and r["findings"][0]["rule"] == "DOSE-PED-01"
    audit = client.get("/api/v1/audit").json()["entries"]
    assert audit[0]["event"] == "verification" and audit[0]["ref"] == r["id"]
    assert client.get("/api/v1/audit/verify").json()["ok"]


def test_verify_validates_input(client):
    assert client.post("/api/v1/verify", json={"patient": {"age": 500}, "orders": []}).status_code == 422


def test_search_combines_sources(client):
    kinds = {r["kind"] for r in client.get("/api/v1/drugs/search", params={"q": "war"}).json()["results"]}
    assert "curated" in kinds
    assert any(r["kind"] == "ddinter" for r in client.get("/api/v1/drugs/search", params={"q": "simv"}).json()["results"])


def test_pair_evidence_and_screen(client):
    e = client.get("/api/v1/evidence/pair", params={"a": "warfarin", "b": "amiodarone"}).json()
    assert e["curated"]["monograph"]["severity"] == "Major"
    assert e["label"]["aMentionsB"]  # synthetic label mentions amiodarone
    s = client.post("/api/v1/screen", json={"entries": ["Dolo 650", "Combiflam", "Warf 5", "Aspirin", "zzqx"]}).json()
    types = {(f["type"], f.get("severity")) for f in s["findings"]}
    assert ("duplicate", "major") in types
    assert any(f["type"] == "interaction" and f["source"] == "DDInter" for f in s["findings"])
    assert s["unresolved"] == ["zzqx"]


def test_drug_profile_and_faers(client):
    p = client.get("/api/v1/drugs/warfarin/profile").json()
    assert p["curated"]["id"] == "warfarin" and p["label"]["sections"] and p["ddinter"]["total"] >= 1
    assert client.get("/api/v1/drugs/warfarin/faers").json()["reports"] > 0


def test_ai_explain_grounded_with_stub(client):
    facts = {"headline": "x", "severity": "critical", "finding": "3,000 mg/day",
             "rationale": "The regimen delivers 3,000 mg/day. It exceeds the ceiling.", "actions": []}
    import time
    for _ in range(20):
        r = client.post("/api/v1/ai/explain", json={"facts": facts})
        if r.status_code != 503:
            break
        time.sleep(0.1)
    assert r.json()["accepted"]


def test_audit_rejects_unknown_events(client):
    assert client.post("/api/v1/audit", json={"event": "delete-everything"}).status_code == 400


def test_verify_resolves_rxnorm_only_brand(client):
    body = {"patient": {"age": 40, "weight": 70}, "orders": [{"line": 1, "name": "Pantoprazole 40", "dose": 40, "freqId": "daily"}]}
    line = client.post("/api/v1/verify", json=body).json()["lines"][0]
    assert line["input"] == "Pantoprazole 40" and line["ingredient"].startswith("ingredient")  # synthetic RxNorm fixture


def test_patient_crud(client):
    p = client.post("/api/v1/patients", json={"name": "Rao, Ishaan", "mrn": "004817", "age": 6, "sex": "M", "weight": 20}).json()
    assert p["id"] and p["name"] == "Rao, Ishaan" and p["created_at"]
    client.post("/api/v1/patients", json={"name": "Nair, Priya", "mrn": "006230", "age": 45, "sex": "F"})
    client.post("/api/v1/patients", json={"name": "No MRN one"})
    client.post("/api/v1/patients", json={"name": "No MRN two", "mrn": ""})  # blank MRNs don't collide

    assert len(client.get("/api/v1/patients").json()["patients"]) == 4
    assert [x["name"] for x in client.get("/api/v1/patients", params={"q": "rao"}).json()["patients"]] == ["Rao, Ishaan"]
    assert [x["mrn"] for x in client.get("/api/v1/patients", params={"q": "0062"}).json()["patients"]] == ["006230"]

    assert client.get(f"/api/v1/patients/{p['id']}").json()["weight"] == 20
    u = client.patch(f"/api/v1/patients/{p['id']}", json={"weight": 21.5}).json()
    assert u["weight"] == 21.5 and u["name"] == "Rao, Ishaan"

    assert client.delete(f"/api/v1/patients/{p['id']}").status_code == 204
    assert client.get(f"/api/v1/patients/{p['id']}").status_code == 404
    assert client.delete(f"/api/v1/patients/{p['id']}").status_code == 404


def test_patient_validation(client):
    assert client.post("/api/v1/patients", json={"name": ""}).status_code == 422
    assert client.post("/api/v1/patients", json={"name": "X", "age": 500}).status_code == 422
    client.post("/api/v1/patients", json={"name": "A", "mrn": "1"})
    assert client.post("/api/v1/patients", json={"name": "B", "mrn": "1"}).status_code == 409
    pid = client.get("/api/v1/patients").json()["patients"][0]["id"]
    assert client.patch(f"/api/v1/patients/{pid}", json={"name": None}).status_code == 422


def test_verify_links_patient_in_audit(client):
    pid = client.post("/api/v1/patients", json={"name": "Nair, Priya", "age": 45, "weight": 70}).json()["id"]
    body = {"patient": {"age": 45, "weight": 70}, "patientId": pid, "record": True,
            "orders": [{"line": 1, "name": "acetaminophen", "dose": 650, "freqId": "q6h"}]}
    r = client.post("/api/v1/verify", json=body).json()
    entry = client.get("/api/v1/audit").json()["entries"][0]
    assert entry["ref"] == r["id"] and entry["payload"]["patientId"] == pid
    assert client.post("/api/v1/verify", json={**body, "patientId": 99999}).status_code == 404


def test_verify_many_order_lines(client):
    names = ["acetaminophen", "warfarin", "omeprazole", "amiodarone"]
    orders = [{"line": i + 1, "name": n, "dose": 5, "freqId": "daily"} for i, n in enumerate(names)]
    r = client.post("/api/v1/verify", json={"patient": {"age": 45, "weight": 70}, "orders": orders}).json()
    assert len(r["lines"]) == 4
    assert any(f["rule"] == "DDI-KB-01" and f["lines"] == [2, 4] for f in r["findings"])

    too_many = [{"line": i + 1, "name": "acetaminophen", "dose": 5} for i in range(16)]
    assert client.post("/api/v1/verify", json={"patient": {}, "orders": too_many}).status_code == 422
    dup_lines = [{"line": 1, "name": "a"}, {"line": 1, "name": "b"}]
    assert client.post("/api/v1/verify", json={"patient": {}, "orders": dup_lines}).status_code == 422
