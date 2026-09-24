"""Shared fetcher for external sources: caching, retries, concurrency and provenance.

Modes (DX_SOURCES):
  live      cache first; fetch when missing or expired; on failure serve stale cache
  offline   cache only — never touches the network
  fixtures  synthetic responses for automated tests (never real data)
"""
from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx

from .cache import Cache

log = logging.getLogger("dx.sources")


class SourceUnavailable(Exception):
    """Raised when a source cannot be reached and nothing is cached."""


@dataclass
class Fetched:
    data: object
    source: str
    url: str
    fetched_at: float
    cached: bool = False
    stale: bool = False
    not_found: bool = False

    def provenance(self) -> dict:
        return {
            "source": self.source,
            "url": self.url,
            "fetchedAt": self.fetched_at,
            "cached": self.cached,
            "stale": self.stale,
        }


@dataclass
class SourceHealth:
    ok: int = 0
    failed: int = 0
    last_error: str | None = None
    last_ok: float | None = None
    last_latency_ms: int | None = None
    streak: int = 0              # consecutive failures
    open_until: float = 0.0      # circuit breaker: skip network until this time

    @property
    def circuit_open(self) -> bool:
        return time.time() < self.open_until


class Fetcher:
    BREAKER_THRESHOLD = 3     # consecutive failures before the circuit opens
    BREAKER_COOLDOWN = 60.0   # seconds to serve cache only before retrying the network

    def __init__(self, cache: Cache, mode: str = "live", timeout: float = 12.0, concurrency: int = 4,
                 ttl_days: int = 30, transport: httpx.AsyncBaseTransport | None = None, redact: tuple[str, ...] = ("api_key",)):
        self.cache = cache
        self.mode = mode
        self.ttl = ttl_days * 86400
        self.redact = redact
        self._sem = asyncio.Semaphore(concurrency)
        if mode == "fixtures" and transport is None:
            from ..fixtures import synthetic_transport  # test data only

            transport = synthetic_transport()
        self._client = httpx.AsyncClient(
            timeout=timeout, transport=transport, follow_redirects=True,
            headers={"User-Agent": "Diagnostix-CDSS/2.0 (medication safety prototype)"},
        )
        self.health: dict[str, SourceHealth] = {}

    async def aclose(self):
        await self._client.aclose()

    def _key(self, url: str, params: dict | None) -> str:
        clean = {k: v for k, v in (params or {}).items() if k not in self.redact}
        return url + ("?" + urlencode(sorted(clean.items())) if clean else "")

    async def get_json(self, source: str, url: str, params: dict | None = None, *, not_found_codes=(404,), ttl: float | None = None) -> Fetched:
        key = self._key(url, params)
        hit = self.cache.get(key)
        ttl = self.ttl if ttl is None else ttl
        if hit and (self.mode == "offline" or time.time() - hit[1] < ttl):
            data, at = hit
            return Fetched(data=data.get("body"), source=source, url=key, fetched_at=at, cached=True, not_found=data.get("nf", False))
        if self.mode == "offline":
            raise SourceUnavailable(f"{source}: offline mode and not cached")

        h = self.health.setdefault(source, SourceHealth())
        if h.circuit_open:  # source recently failing: answer from cache without waiting on the network
            if hit:
                data, at = hit
                return Fetched(data=data.get("body"), source=source, url=key, fetched_at=at, cached=True, stale=True, not_found=data.get("nf", False))
            raise SourceUnavailable(f"{source}: temporarily unavailable ({h.last_error})")
        t0 = time.time()
        try:
            async with self._sem:
                body, nf = await self._request(url, params, not_found_codes)
            h.ok += 1
            h.streak = 0
            h.last_ok = time.time()
            h.last_latency_ms = int((time.time() - t0) * 1000)
            at = self.cache.put(key, source, {"body": body, "nf": nf})
            return Fetched(data=body, source=source, url=key, fetched_at=at, not_found=nf)
        except Exception as exc:  # network, HTTP or JSON failure
            h.failed += 1
            h.streak += 1
            if h.streak >= self.BREAKER_THRESHOLD:
                h.open_until = time.time() + self.BREAKER_COOLDOWN
            h.last_error = f"{type(exc).__name__}: {exc}"[:300]
            log.warning("%s request failed: %s", source, h.last_error)
            if hit:
                data, at = hit
                return Fetched(data=data.get("body"), source=source, url=key, fetched_at=at, cached=True, stale=True, not_found=data.get("nf", False))
            raise SourceUnavailable(f"{source}: {h.last_error}") from exc

    async def _request(self, url, params, not_found_codes):
        for attempt in range(3):
            res = await self._client.get(url, params=params)
            if res.status_code in not_found_codes:
                return None, True
            if res.status_code == 429 or res.status_code >= 500:
                if attempt < 2:
                    await asyncio.sleep(0.8 * (attempt + 1))
                    continue
            res.raise_for_status()
            return res.json(), False
        res.raise_for_status()
        return res.json(), False
