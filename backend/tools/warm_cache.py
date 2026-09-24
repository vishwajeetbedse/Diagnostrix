"""Pre-fetch everything the demo needs so it runs with no internet.

    python -m backend.tools.warm_cache              # demo drugs and pairs
    python -m backend.tools.warm_cache --extra metformin atorvastatin

Run it on good Wi-Fi before the event. Afterwards start the server with
DX_SOURCES=offline (or leave it on live: failed requests fall back to this cache).
"""
from __future__ import annotations

import argparse
import asyncio
import itertools
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.app.config import Settings  # noqa: E402
from backend.app.container import Container  # noqa: E402

DEMO_PAIRS = [("warfarin", "amiodarone"), ("tramadol", "linezolid"), ("lithium carbonate", "ibuprofen"),
              ("digoxin", "clarithromycin"), ("warfarin", "ibuprofen"), ("warfarin", "fluconazole"),
              ("amiodarone", "digoxin"), ("simvastatin", "clarithromycin"), ("warfarin", "aspirin")]
DEMO_SEARCH = ["Dolo 650", "Combiflam", "Warf 5", "Brufen 400", "Pan 40", "Tylenol", "Pantoprazole", "Aspirin", "Simvastatin", "Metformin"]


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--extra", nargs="*", default=[], help="additional drug names to cache")
    args = ap.parse_args()
    c = Container(Settings(sources="live"))
    drugs = sorted({d["name"].lower() for d in c.kb.drugs} | {x for p in DEMO_PAIRS for x in p} | {e.lower() for e in args.extra})
    t0 = time.time()

    async def step(label, coro):
        try:
            await coro
            print(f"  ✓ {label}")
        except Exception as exc:
            print(f"  ✗ {label}: {exc}")

    print(f"\n  Warming cache for {len(drugs)} drugs and {len(DEMO_PAIRS)} pairs …\n")
    await step("RxNorm name list", c.rxnorm.display_names())
    for term in DEMO_SEARCH:
        await step(f"resolve {term}", c.resolver.resolve(term))
    for d in drugs:
        await step(f"label + FAERS profile · {d}", asyncio.gather(c.evidence.drug(d), c.evidence.faers(d)))
    for a, b in DEMO_PAIRS:
        await step(f"pair evidence + signal · {a} × {b}", asyncio.gather(c.evidence.pair(a, b), c.evidence.signal(a, b)))
    for a, b in itertools.combinations(["acetaminophen", "ibuprofen"], 2):
        await step(f"pair evidence · {a} × {b}", c.evidence.pair(a, b))
    stats = c.cache.stats()
    await c.shutdown()
    print(f"\n  Done in {time.time() - t0:.0f} s · cache: " + ", ".join(f"{k} {v['entries']}" for k, v in stats.items()) + "\n")


if __name__ == "__main__":
    asyncio.run(main())
