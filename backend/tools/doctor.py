"""Check every data source from this machine and say exactly what works.

    python -m backend.tools.doctor
"""
from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.app.config import Settings  # noqa: E402
from backend.app.container import Container  # noqa: E402

OK, BAD, WARN = "  [ OK ]", "  [FAIL]", "  [WARN]"


async def check(name, coro, describe):
    t0 = time.time()
    try:
        value = await coro
        ms = int((time.time() - t0) * 1000)
        msg = describe(value)
        print(f"{OK if msg else WARN} {name:<28} {msg or 'responded but returned no data'}  ({ms} ms)")
        return bool(msg)
    except Exception as exc:
        print(f"{BAD} {name:<28} {type(exc).__name__}: {str(exc)[:160]}")
        return False


async def main():
    import logging

    logging.disable(logging.WARNING)
    s = Settings(sources="live")
    c = Container(s)
    print(f"\n  Diagnostix doctor — data folder {s.data_dir}\n")

    integ = c.kb.integrity()
    print(f"{OK if integ['ok'] else BAD} {'Curated formulary':<28} {len(c.kb.drugs)} drugs · {c.kb.version}")
    meta = c.ddinter.meta()
    if meta.get("available"):
        print(f"{OK} {'DDInter (local)':<28} {int(meta['pairs']):,} interaction records · {int(meta['drugs']):,} drugs")
    else:
        print(f"{BAD} {'DDInter (local)':<28} not imported — run: python -m backend.tools.import_ddinter")

    results = [
        await check("openFDA · drug labels", c.openfda.label("warfarin"),
                    lambda v: v[0] and f"warfarin label, {len(v[0]['sections'])} sections, updated {v[0]['effectiveTime']}"),
        await check("openFDA · FAERS", c.openfda.total(None), lambda v: v[0] and f"{v[0]:,} adverse event reports"),
        await check("openFDA · FAERS reactions", c.openfda.count('patient.drug.openfda.generic_name:"warfarin"', "patient.reaction.reactionmeddrapt.exact", 3),
                    lambda v: v[0] and "top: " + ", ".join(r["term"].lower() for r in v[0])),
        await check("openFDA · FAERS countries", c.openfda._countries('patient.drug.openfda.generic_name:"warfarin"'),
                    lambda v: v and f"{len(v)} reporting countries, e.g. {', '.join(r['term'] for r in v[:4])}"),
        await check("RxNorm · resolve brand", c.rxnorm.resolve("Tylenol"), lambda v: v and f"Tylenol → {', '.join(v['ingredients'])}"),
        await check("RxNorm · name list", c.rxnorm.display_names(), lambda v: v and f"{len(v):,} names for search"),
    ]
    print(f"{OK if s.openfda_key else WARN} {'openFDA API key':<28} "
          + ("set" if s.openfda_key else "not set — limit is 1,000 requests/day; get a free key at https://open.fda.gov/apis/authentication/"))

    info = c.llm.info()
    print(f"  [INFO] {'AI model':<28} {info['model']} (loads when the server starts)")
    await c.shutdown()
    print("\n  " + ("All live sources reachable." if all(results) else "Some sources failed — the app will fall back to cache and local data for those.") + "\n")


if __name__ == "__main__":
    asyncio.run(main())
