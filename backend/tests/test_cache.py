"""Pure unit tests for the server-side response cache.

No server, no Postgres - `payload`/`answer` take a plain factory callable, so
the semantic/analytics layer never has to be exercised here.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app import cache


class FakeClock:
    def __init__(self, start: float = 1000.0):
        self.value = start

    def __call__(self) -> float:
        return self.value

    def tick(self, seconds: float) -> None:
        self.value += seconds


def fake_settings(*, enabled=True, ttl=300, ask_max=128):
    return SimpleNamespace(cache_enabled=enabled, cache_ttl_seconds=ttl, ask_cache_max_entries=ask_max)


@pytest.fixture(autouse=True)
def isolate():
    """Every test starts and ends with a clean cache - reset_all() also
    resets the real reset_bounds_cache/reset_prompt_cache, which is harmless
    (no DB access, just clearing a None-checked global)."""
    cache.reset_all()
    yield
    cache.reset_all()


@pytest.fixture
def settings(monkeypatch):
    """Returns a mutable holder so tests can adjust settings mid-test."""
    holder = fake_settings()
    monkeypatch.setattr("app.cache.get_settings", lambda: holder)
    return holder


@pytest.fixture
def clock(monkeypatch):
    fake = FakeClock()
    monkeypatch.setattr("app.cache.time.monotonic", fake)
    # The autouse `isolate` fixture already ran reset_all() against the real
    # clock, so _generation_started holds a real monotonic value that has no
    # relationship to `fake`'s. Re-anchor it now that the patch is live, or
    # "elapsed" below would be a nonsense (real - fake) value.
    cache.reset_all()
    return fake


# --- payload() ---------------------------------------------------------


def test_payload_calls_factory_once_per_key(settings):
    calls = []

    def factory():
        calls.append(1)
        return "value"

    assert cache.payload("k", factory) == "value"
    assert cache.payload("k", factory) == "value"
    assert len(calls) == 1


def test_payload_is_independent_per_key(settings):
    assert cache.payload("a", lambda: "A") == "A"
    assert cache.payload("b", lambda: "B") == "B"


def test_payload_does_not_cache_exceptions(settings):
    calls = []

    def failing():
        calls.append(1)
        raise KeyError("boom")

    with pytest.raises(KeyError):
        cache.payload("k", failing)
    with pytest.raises(KeyError):
        cache.payload("k", failing)
    assert len(calls) == 2  # never cached, so the factory ran both times


def test_payload_bypassed_when_cache_disabled(monkeypatch):
    monkeypatch.setattr("app.cache.get_settings", lambda: fake_settings(enabled=False))
    calls = []

    def factory():
        calls.append(1)
        return "value"

    cache.payload("k", factory)
    cache.payload("k", factory)
    assert len(calls) == 2


# --- answer() -----------------------------------------------------------


def test_answer_calls_factory_once_per_key(settings):
    calls = []

    def factory():
        calls.append(1)
        return "answer"

    assert cache.answer("q1", factory) == "answer"
    assert cache.answer("q1", factory) == "answer"
    assert len(calls) == 1


def test_answer_does_not_cache_exceptions(settings):
    calls = []

    def failing():
        calls.append(1)
        raise RuntimeError("model unavailable")

    with pytest.raises(RuntimeError):
        cache.answer("q1", failing)
    with pytest.raises(RuntimeError):
        cache.answer("q1", failing)
    assert len(calls) == 2


def test_answer_lru_evicts_oldest_beyond_cap(monkeypatch):
    monkeypatch.setattr("app.cache.get_settings", lambda: fake_settings(ask_max=2))

    cache.answer("q1", lambda: "a1")
    cache.answer("q2", lambda: "a2")
    cache.answer("q3", lambda: "a3")  # over the cap of 2 -> q1 evicted

    assert "q1" not in cache._answers
    assert "q2" in cache._answers
    assert "q3" in cache._answers


def test_answer_lru_touch_on_hit_protects_from_eviction(monkeypatch):
    monkeypatch.setattr("app.cache.get_settings", lambda: fake_settings(ask_max=2))

    cache.answer("q1", lambda: "a1")
    cache.answer("q2", lambda: "a2")
    cache.answer("q1", lambda: "should not run")  # re-touch q1, now most-recent
    cache.answer("q3", lambda: "a3")  # over the cap -> least-recent (q2) evicted

    assert "q1" in cache._answers
    assert "q2" not in cache._answers
    assert "q3" in cache._answers


def test_answer_cache_disabled_by_zero_cap(monkeypatch):
    monkeypatch.setattr("app.cache.get_settings", lambda: fake_settings(ask_max=0))
    calls = []

    def factory():
        calls.append(1)
        return "answer"

    cache.answer("q1", factory)
    cache.answer("q1", factory)
    assert len(calls) == 2
    assert len(cache._answers) == 0


# --- TTL / generation rollover -------------------------------------------


def test_ttl_expiry_clears_both_stores_and_cascades_resets(settings, clock, monkeypatch):
    bounds_calls = []
    prompt_calls = []
    monkeypatch.setattr("app.cache.reset_bounds_cache", lambda: bounds_calls.append(1))
    monkeypatch.setattr("app.cache.reset_prompt_cache", lambda: prompt_calls.append(1))
    settings.cache_ttl_seconds = 100

    cache.payload("kpis", lambda: "v1")
    cache.answer("q1", lambda: "a1")

    clock.tick(50)  # within TTL
    assert cache.payload("kpis", lambda: "v2") == "v1"  # still cached
    assert bounds_calls == [] and prompt_calls == []

    clock.tick(51)  # now 101s since start -> TTL elapsed
    assert cache.payload("kpis", lambda: "v3") == "v3"  # recomputed
    assert bounds_calls == [1]
    assert prompt_calls == [1]
    assert "q1" not in cache._answers  # answers cleared too


def test_zero_ttl_means_never_expire(monkeypatch, clock):
    monkeypatch.setattr("app.cache.get_settings", lambda: fake_settings(ttl=0))
    assert cache.payload("kpis", lambda: "v1") == "v1"
    clock.tick(10_000_000)
    assert cache.payload("kpis", lambda: "v2") == "v1"  # never expired


# --- reset_all() ----------------------------------------------------------


def test_reset_all_clears_everything(settings):
    cache.payload("kpis", lambda: "v1")
    cache.answer("q1", lambda: "a1")
    cache.reset_all()
    assert cache.payload("kpis", lambda: "v2") == "v2"
    assert cache.answer("q1", lambda: "a2") == "a2"
