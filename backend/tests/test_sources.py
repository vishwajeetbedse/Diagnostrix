"""Source and service tests: name resolution, DDInter lookup, ROR maths, label extraction, cache and offline mode, circuit breaker, audit hash chain, AI grounding check."""
import asyncio

from backend.app.services import prompts
from backend.app.services.audit import AuditLedger
from backend.app.services.resolver import normalise
from backend.app.sources.cache import Cache
from backend.app.sources.http import Fetcher, SourceUnavailable
from backend.app.sources.openfda import label_mentions, ror


def run(coro):
    return asyncio.new_event_loop().run_until_complete(coro)


def test_normalise():
    assert normalise("Dolo-650 Tablet") == "dolo"
    assert normalise("Warfarin 5 mg") == "warfarin"


def test_resolution_order(container):
    r = run(container.resolver.resolve("Combiflam"))
    assert r["via"] == "combination" and set(r["ingredients"]) == {"ibuprofen", "acetaminophen"}
    assert run(container.resolver.resolve("Simvastatin 40"))["via"] == "ddinter"
    assert run(container.resolver.resolve("Pantoprazole"))["via"] == "rxnorm"
    assert run(container.resolver.resolve("zzqx"))["ingredients"] == []


def test_ddinter_synonyms_and_order(container):
    assert container.ddinter.lookup("aspirin", "warfarin")["level"] == "Major"
    assert container.ddinter.lookup("acetaminophen", "warfarin")["level"] == "Minor"  # paracetamol synonym
    assert container.ddinter.interactions("warfarin")["counts"]["Major"] == 1


def test_ror_matches_hand_calculation():
    # a=20 pair+R, n_x=100, n_r=1000, N=100000 → (20/80)/(980/98920)
    r = ror(20, 100, 1000, 100_000)
    assert abs(r["ror"] - (20 / 80) / (980 / 98920)) < 0.01
    assert r["signal"] and r["lo"] > 1
    assert ror(0, 100, 1000, 100_000) is None


def test_label_mentions_extracts_sentences():
    label = {"sections": [{"key": "drug_interactions", "title": "Drug interactions",
                           "text": "Amiodarone increases prothrombin time. Monitor INR closely. Aspirin adds bleeding risk."}]}
    out = label_mentions(label, ["amiodarone"])
    assert out == [{"section": "Drug interactions", "text": "Amiodarone increases prothrombin time.", "match": "Amiodarone"}]


def test_fixture_faers_profile_and_signal(container):
    p = run(container.evidence.faers("warfarin"))
    assert p["reports"] > 0 and p["reactions"] and p["countries"] and p["years"]
    s = run(container.evidence.signal("warfarin", "amiodarone"))
    assert s["totals"]["pair"] > 0 and s["reactions"][0]["pair"]["ror"] > 0


def test_offline_mode_serves_cache_and_fails_cleanly(tmp_path):
    cache = Cache(tmp_path / "c.sqlite3")
    live = Fetcher(cache, mode="fixtures")
    run(live.get_json("t", "https://api.fda.gov/drug/event.json", {"limit": 1}))
    off = Fetcher(cache, mode="offline")
    got = run(off.get_json("t", "https://api.fda.gov/drug/event.json", {"limit": 1}))
    assert got.cached and got.data["meta"]["results"]["total"] == 20_000_000
    try:
        run(off.get_json("t", "https://api.fda.gov/drug/event.json", {"limit": 2}))
        raise AssertionError("expected SourceUnavailable")
    except SourceUnavailable:
        pass


def test_api_key_not_stored_in_cache_key(tmp_path):
    f = Fetcher(Cache(tmp_path / "c.sqlite3"), mode="fixtures")
    assert "secret" not in f._key("https://x", {"api_key": "secret", "q": "1"})


def test_audit_chain_detects_tampering(tmp_path):
    led = AuditLedger(tmp_path / "a.sqlite3")
    for i in range(3):
        led.append("verification", f"VR-{i}", {"i": i})
    assert led.verify()["ok"]
    led.tamper_demo()
    v = led.verify()
    assert not v["ok"] and v["brokenAt"] == 1


def test_grounding_check():
    facts = "3,000 mg/day ceiling 1,500 mg/day 200% CYP2E1"
    assert prompts.ungrounded_numbers("It delivers 3000 mg/day, 200% of 1,500 via CYP2E1.", facts) == []
    assert prompts.ungrounded_numbers("Toxic in 24% within 48 h.", facts) == ["24", "48"]


def test_circuit_breaker_serves_cache_after_repeated_failures(tmp_path):
    import httpx

    calls = {"n": 0}

    def boom(request):
        calls["n"] += 1
        raise httpx.ConnectError("no network")

    f = Fetcher(Cache(tmp_path / "c.sqlite3"), mode="live", transport=httpx.MockTransport(boom))
    for i in range(5):
        try:
            run(f.get_json("src", "https://example.org/x", {"i": i}))
        except SourceUnavailable:
            pass
    assert calls["n"] == 3  # after 3 failures the breaker stops hitting the network
    assert f.health["src"].circuit_open
