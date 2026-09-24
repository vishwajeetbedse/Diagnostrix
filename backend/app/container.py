"""Application container — builds and holds every service once per process."""
from __future__ import annotations

import asyncio
import logging

from .config import Settings
from .core.formulary import Formulary
from .services.audit import AuditLedger
from .services.evidence import Evidence
from .services.llm import LocalLLM
from .services.patients import PatientStore
from .services.resolver import Resolver, normalise
from .sources.cache import Cache
from .sources.ddinter import DDInter
from .sources.http import Fetcher, SourceUnavailable
from .sources.openfda import OpenFDA
from .sources.rxnorm import RxNorm

log = logging.getLogger("dx.container")


class Container:
    def __init__(self, settings: Settings, llm: LocalLLM | None = None, transport=None):
        self.settings = settings
        self.kb = Formulary(settings.formulary_path)
        self.cache = Cache(settings.cache_db)
        self.fetcher = Fetcher(self.cache, mode=settings.sources, timeout=settings.http_timeout,
                               concurrency=settings.http_concurrency, ttl_days=settings.cache_ttl_days, transport=transport)
        self.ddinter = DDInter(settings.ddinter_db)
        self.openfda = OpenFDA(self.fetcher, settings.openfda_key)
        self.rxnorm = RxNorm(self.fetcher)
        self.resolver = Resolver(self.kb, self.ddinter, self.rxnorm)
        self.evidence = Evidence(self.kb, self.ddinter, self.openfda, self.resolver)
        self.audit = AuditLedger(settings.audit_db)
        self.patients = PatientStore(settings.patients_db)
        self.llm = llm or LocalLLM()
        self.rx_names: list[str] = []
        self._curated_names = self._build_curated_names()

    def _build_curated_names(self) -> list[dict]:
        out = []
        for d in self.kb.drugs:
            out.append({"name": d["name"], "kind": "curated", "ingredient": d["name"].lower(), "detail": d["cls"]})
            for b in d.get("brands", []):
                out.append({"name": b, "kind": "brand", "ingredient": d["name"].lower(), "detail": f"Brand of {d['name']}"})
        for brand, ids in self.kb.combinations.items():
            out.append({"name": brand, "kind": "combination", "ingredient": None,
                        "detail": " + ".join(self.kb.drug(i)["name"] for i in ids)})
        return out

    async def startup(self):
        self.llm.start()
        asyncio.create_task(self._load_rx_names())

    async def _load_rx_names(self):
        try:
            names = await self.rxnorm.display_names()
            self.rx_names = sorted(set(n.lower() for n in names))
            log.info("RxNorm autocomplete list: %s names", f"{len(self.rx_names):,}")
        except SourceUnavailable as exc:
            log.warning("RxNorm name list unavailable: %s", exc)

    async def shutdown(self):
        await self.fetcher.aclose()

    def search(self, q: str, limit: int = 12) -> list[dict]:
        key = normalise(q) or q.lower().strip()
        if len(key) < 2:
            return []
        out, seen = [], set()

        def push(item):
            k = item["name"].lower()
            if k not in seen:
                seen.add(k)
                out.append(item)

        for item in self._curated_names:
            if item["name"].lower().startswith(key):
                push(item)
        for name in self.ddinter.search_names(key, limit):
            push({"name": name, "kind": "ddinter", "ingredient": name.lower(), "detail": "DDInter interaction database"})
        if len(out) < limit and self.rx_names:
            import bisect

            i = bisect.bisect_left(self.rx_names, key)
            while i < len(self.rx_names) and self.rx_names[i].startswith(key) and len(out) < limit:
                push({"name": self.rx_names[i], "kind": "rxnorm", "ingredient": None, "detail": "RxNorm"})
                i += 1
        return out[:limit]
