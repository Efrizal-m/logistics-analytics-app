"""Per-client-IP rate limiting.

Token bucket, in-process, no external store. Chosen over a fixed window
(lets a client burst 2x the quota across a window boundary - unacceptable for
/api/ask, which spends real money per call) and over a sliding-window log
(needs an unbounded-per-client timestamp history, which is the exact resource
a flood would exhaust). A bucket refilled to capacity is indistinguishable
from a bucket that was never created, which is what makes eviction cheap: the
common case (many clients, most idle) needs no bookkeeping at all.

This is per-process state. The API runs as one container with one uvicorn
worker, so that is the whole store; running multiple workers or replicas
would multiply the effective quota by however many there are, and a shared
store (Redis) would be needed to keep a single limit across them.

Client identity is the hard part, not the arithmetic. This API sits behind an
external reverse proxy (see docker-compose.yml's proxy-net), so
`request.client.host` is the proxy's address unless the request is
specifically walked back through X-Forwarded-For - and trusting that header
from just anyone lets a client set their own rate-limit identity for free.
`client_key()` only believes X-Forwarded-For when the direct peer is in
`settings.trusted_proxy_list`.
"""

from __future__ import annotations

import ipaddress
import math
import threading
import time
from dataclasses import dataclass
from functools import lru_cache

from fastapi import HTTPException, Request

from app.config import get_settings


def _is_trusted(host: str, trusted: list[str]) -> bool:
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        # Not a parseable IP at all - e.g. Starlette's TestClient uses the
        # literal string "testclient" as the peer. Treat as untrusted rather
        # than raising: an unrecognized peer should never get to claim an
        # arbitrary identity via a header.
        return False
    for entry in trusted:
        try:
            if "/" in entry:
                if addr in ipaddress.ip_network(entry, strict=False):
                    return True
            elif addr == ipaddress.ip_address(entry):
                return True
        except ValueError:
            continue
    return False


def client_key(request: Request) -> str:
    """The identity a rate limit is keyed on.

    Walks X-Forwarded-For right-to-left, because a proxy chain appends
    ("$proxy_add_x_forwarded_for" in nginx), which puts any client-supplied
    value on the left - taking the first entry is trivially spoofable.
    Returns the rightmost entry that is not itself a trusted proxy. Only
    consulted at all when the direct peer is trusted; otherwise the peer
    itself is the key, so an untrusted caller cannot pick its own identity.
    """
    peer = request.client.host if request.client else None
    if peer is None:
        return "unknown"

    trusted = get_settings().trusted_proxy_list
    if not _is_trusted(peer, trusted):
        return peer

    forwarded = request.headers.get("x-forwarded-for")
    if not forwarded:
        return peer

    chain = [part.strip() for part in forwarded.split(",") if part.strip()]
    for candidate in reversed(chain):
        if not _is_trusted(candidate, trusted):
            return candidate
    # Every hop in the chain is a trusted proxy - fall back to the peer.
    return peer


@dataclass
class _Bucket:
    tokens: float
    updated: float


class RateLimiter:
    """A token bucket per client key, with a bounded number of keys tracked."""

    def __init__(self, *, requests: int, window_seconds: float, max_clients: int) -> None:
        self.capacity = float(requests)
        self.refill_per_second = requests / window_seconds
        self.max_clients = max_clients
        self._buckets: dict[str, _Bucket] = {}
        self._lock = threading.Lock()

    def check(self, key: str) -> float | None:
        """Consume one token for `key`. Returns None if allowed, else the
        number of seconds until a token will next be available."""
        now = time.monotonic()
        with self._lock:
            bucket = self._buckets.get(key)
            if bucket is None:
                self._evict_locked(now)
                bucket = _Bucket(tokens=self.capacity, updated=now)
                self._buckets[key] = bucket

            elapsed = now - bucket.updated
            tokens = min(self.capacity, bucket.tokens + elapsed * self.refill_per_second)

            if tokens >= 1:
                bucket.tokens = tokens - 1
                bucket.updated = now
                return None

            bucket.tokens = tokens
            bucket.updated = now
            missing = 1 - tokens
            return missing / self.refill_per_second

    def _evict_locked(self, now: float) -> None:
        """Called only when about to insert a new key. Keeps the map bounded
        without ever clearing it outright, which would hand every client a
        free pass simultaneously."""
        if len(self._buckets) < self.max_clients:
            return

        # A bucket refilled to capacity carries no information - dropping it
        # is lossless and, under normal traffic, keeps the map small on its
        # own without ever touching the second branch below.
        full = [
            k
            for k, b in self._buckets.items()
            if min(self.capacity, b.tokens + (now - b.updated) * self.refill_per_second)
            >= self.capacity
        ]
        for k in full:
            del self._buckets[k]

        if len(self._buckets) < self.max_clients:
            return

        # Still at the cap - a genuine flood of distinct keys. Drop the
        # least-recently-seen entries rather than clearing everything.
        by_age = sorted(self._buckets.items(), key=lambda item: item[1].updated)
        for k, _ in by_age[: len(by_age) // 4 + 1]:
            del self._buckets[k]

    def clear(self) -> None:
        with self._lock:
            self._buckets.clear()


@lru_cache
def ask_limiter() -> RateLimiter:
    settings = get_settings()
    return RateLimiter(
        requests=settings.ask_rate_limit_requests,
        window_seconds=settings.ask_rate_limit_window_seconds,
        max_clients=settings.rate_limit_max_clients,
    )


@lru_cache
def dashboard_limiter() -> RateLimiter:
    settings = get_settings()
    return RateLimiter(
        requests=settings.dashboard_rate_limit_requests,
        window_seconds=settings.dashboard_rate_limit_window_seconds,
        max_clients=settings.rate_limit_max_clients,
    )


def reset_limiters() -> None:
    """Test/reload hook, matching reset_bounds_cache / reset_prompt_cache."""
    ask_limiter.cache_clear()
    dashboard_limiter.cache_clear()


def _enforce(limiter: RateLimiter, request: Request) -> None:
    if not get_settings().rate_limit_enabled:
        return
    retry_after = limiter.check(client_key(request))
    if retry_after is not None:
        seconds = max(1, math.ceil(retry_after))
        raise HTTPException(
            status_code=429,
            detail=f"Too many requests. Try again in {seconds} seconds.",
            headers={"Retry-After": str(seconds)},
        )


async def ask_rate_limit(request: Request) -> None:
    _enforce(ask_limiter(), request)


async def dashboard_rate_limit(request: Request) -> None:
    _enforce(dashboard_limiter(), request)
