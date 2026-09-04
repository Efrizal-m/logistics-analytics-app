"""Server-side response cache.

Safe because the dataset cannot change at runtime: the API connects as a role
granted only SELECT, with INSERT/UPDATE/DELETE/TRUNCATE revoked (see
app/seed.py's grant_readonly), and no query path in this codebase reads
wall-clock time - relative windows resolve against the table's own max
order_date, never against `today`. So a cached response is a pure function of
table contents plus code, and stays correct until either changes.

Two stores, one shared "generation":

- `payload()` is for the fixed, code-defined key space (kpis, schema, one key
  per preset chart - a handful of keys total).
- `answer()` is for /api/ask, where the key is derived from user input, so it
  is bounded by an LRU cap rather than trusted to stay small on its own.

A single process-wide generation clock (rather than a TTL per entry) means
everything expires together: you never serve a fresh KPI payload alongside a
system prompt or dataset-bounds cache computed against different data. When
the generation rolls over, reset_bounds_cache() and reset_prompt_cache() are
called too - this is what gives those two currently-orphaned helpers a
caller, and is what makes a `python -m app.seed` re-run (which changes the
table without restarting this process) get picked up within CACHE_TTL_SECONDS
instead of silently staying stale forever, which is what happens today.

Cached values are returned by reference. Nothing in this codebase mutates a
response model after building it, so this is safe; a cache that deep-copied
on every hit would spend more than it saves.
"""

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from typing import Any, Callable, TypeVar

from app.ai.prompts import reset_prompt_cache
from app.config import get_settings
from app.semantic.executor import reset_bounds_cache

T = TypeVar("T")

_lock = threading.Lock()
_generation_started: float = time.monotonic()
_payloads: dict[str, Any] = {}
_answers: "OrderedDict[str, Any]" = OrderedDict()


def _expire_locked() -> None:
    """Call with _lock held. Rolls over the generation if the TTL elapsed."""
    global _generation_started
    settings = get_settings()
    ttl = settings.cache_ttl_seconds
    if ttl <= 0:
        return
    if time.monotonic() - _generation_started < ttl:
        return
    _payloads.clear()
    _answers.clear()
    _generation_started = time.monotonic()
    reset_bounds_cache()
    reset_prompt_cache()


def payload(key: str, factory: Callable[[], T]) -> T:
    """Cache the result of `factory` under `key` for the fixed dashboard
    payloads. `factory` runs outside the lock so a slow computation never
    blocks other keys."""
    if not get_settings().cache_enabled:
        return factory()

    with _lock:
        _expire_locked()
        if key in _payloads:
            return _payloads[key]

    value = factory()

    with _lock:
        _payloads[key] = value
    return value


def answer(key: str, factory: Callable[[], T]) -> T:
    """Like payload(), but for the user-keyed /api/ask cache: bounded by an
    LRU eviction instead of a fixed key set, since the key space is whatever
    questions people type. A cap of 0 disables caching for this call - the
    factory always runs and nothing is stored."""
    max_entries = get_settings().ask_cache_max_entries
    if not get_settings().cache_enabled or max_entries <= 0:
        return factory()

    with _lock:
        _expire_locked()
        if key in _answers:
            _answers.move_to_end(key)
            return _answers[key]

    # Errors are never cached: an exception from factory() propagates here
    # without touching _answers, so a transient model failure never gets
    # stuck as a "cached" outcome.
    value = factory()

    with _lock:
        _answers[key] = value
        _answers.move_to_end(key)
        while len(_answers) > max_entries:
            _answers.popitem(last=False)
    return value


def reset_all() -> None:
    """Test/reload hook. Clears both stores and the generation clock, and
    cascades to the other module-global caches this one is meant to keep in
    sync with."""
    global _generation_started
    with _lock:
        _payloads.clear()
        _answers.clear()
        _generation_started = time.monotonic()
    reset_bounds_cache()
    reset_prompt_cache()
