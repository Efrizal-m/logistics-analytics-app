"""Pure unit tests for the token bucket and client-key resolution.

No server, no Postgres - these run even when the database fixture in
conftest.py would skip the rest of the suite. Time is faked via a monkeypatch
on time.monotonic so refill arithmetic is exact rather than timing-dependent.
"""

from __future__ import annotations

import threading
from types import SimpleNamespace

import pytest

from app.ratelimit import RateLimiter, client_key


class FakeClock:
    def __init__(self, start: float = 1000.0):
        self.value = start

    def __call__(self) -> float:
        return self.value

    def tick(self, seconds: float) -> None:
        self.value += seconds


@pytest.fixture
def clock(monkeypatch):
    fake = FakeClock()
    monkeypatch.setattr("app.ratelimit.time.monotonic", fake)
    return fake


# --- RateLimiter: refill arithmetic -----------------------------------------


def test_allows_up_to_capacity_then_blocks(clock):
    limiter = RateLimiter(requests=3, window_seconds=60, max_clients=100)
    assert limiter.check("a") is None
    assert limiter.check("a") is None
    assert limiter.check("a") is None
    retry_after = limiter.check("a")
    assert retry_after is not None
    assert retry_after > 0


def test_retry_after_matches_refill_rate(clock):
    # capacity=2, window=10s -> refill 0.2 tokens/sec. Exhausting both tokens
    # leaves 1 missing, so the wait is 1 / 0.2 = 5s.
    limiter = RateLimiter(requests=2, window_seconds=10, max_clients=100)
    limiter.check("a")
    limiter.check("a")
    retry_after = limiter.check("a")
    assert retry_after == pytest.approx(5.0)


def test_refill_over_time_restores_a_token(clock):
    limiter = RateLimiter(requests=2, window_seconds=10, max_clients=100)
    limiter.check("a")
    limiter.check("a")
    assert limiter.check("a") is not None  # exhausted

    clock.tick(5.0)  # half the window -> one token back
    assert limiter.check("a") is None
    assert limiter.check("a") is not None  # spent it again


def test_distinct_keys_have_independent_budgets(clock):
    limiter = RateLimiter(requests=1, window_seconds=60, max_clients=100)
    assert limiter.check("a") is None
    assert limiter.check("a") is not None
    assert limiter.check("b") is None  # "b" is unaffected by "a"'s usage


def test_clear_resets_every_bucket(clock):
    limiter = RateLimiter(requests=1, window_seconds=60, max_clients=100)
    limiter.check("a")
    assert limiter.check("a") is not None
    limiter.clear()
    assert limiter.check("a") is None


# --- RateLimiter: bounded memory ---------------------------------------------


def test_full_buckets_are_evicted_losslessly(clock):
    """A bucket that has refilled to capacity carries no information, so
    inserting a new key at the cap should prefer to drop that one over an
    LRU guess. Window is 1s, so "a" needs >=1s of age to count as full; "b"
    must stay under that when "c" triggers eviction, or both would qualify."""
    limiter = RateLimiter(requests=1, window_seconds=1, max_clients=2)

    limiter.check("a")  # tokens: 1 -> 0, at t=1000.0
    clock.tick(1.5)  # "a" is now long since refilled to full (elapsed >= 1s)
    limiter.check("b")  # new key, len(buckets)=1 < cap -> no eviction check yet

    clock.tick(0.1)  # "b" is still fresh (elapsed 0.1s < 1s window)
    limiter.check("c")  # at the cap: only "a" (full) should be dropped

    assert "a" not in limiter._buckets
    assert "b" in limiter._buckets
    assert "c" in limiter._buckets


def test_lru_fallback_when_nothing_is_full(clock):
    """If no bucket has refilled to capacity, eviction falls back to dropping
    the least-recently-seen entries rather than growing unboundedly."""
    limiter = RateLimiter(requests=100, window_seconds=1000, max_clients=2)

    limiter.check("a")
    clock.tick(0.01)
    limiter.check("b")  # neither near-full given the slow refill rate

    clock.tick(0.01)
    limiter.check("c")  # at the cap, nothing full -> drop the oldest ("a")

    assert "a" not in limiter._buckets
    assert "b" in limiter._buckets
    assert "c" in limiter._buckets


def test_thread_safety_no_lost_or_double_counted_tokens():
    """Capacity of 20, slow refill so it does not matter within the test's
    wall-clock duration, hammered from 8 threads. Exactly 20 checks across
    all threads should succeed - a race in check-and-consume would show up as
    more (double-spent tokens) or fewer (lost updates) than 20."""
    limiter = RateLimiter(requests=20, window_seconds=1000, max_clients=10)
    allowed = []
    lock = threading.Lock()

    def worker():
        for _ in range(5):
            result = limiter.check("shared")
            if result is None:
                with lock:
                    allowed.append(1)

    threads = [threading.Thread(target=worker) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(allowed) == 20


# --- client_key ---------------------------------------------------------


def fake_request(peer: str | None, xff: str | None = None):
    client = SimpleNamespace(host=peer) if peer is not None else None
    headers = {"x-forwarded-for": xff} if xff else {}
    return SimpleNamespace(client=client, headers=headers)


@pytest.fixture
def trusted(monkeypatch):
    """Trust the same RFC1918 + loopback ranges as the real default."""
    fake_settings = SimpleNamespace(
        trusted_proxy_list=["127.0.0.1", "::1", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]
    )
    monkeypatch.setattr("app.ratelimit.get_settings", lambda: fake_settings)


def test_untrusted_peer_ignores_forwarded_header(trusted):
    # A directly-connected public client cannot claim its own identity.
    request = fake_request("203.0.113.5", xff="9.9.9.9")
    assert client_key(request) == "203.0.113.5"


def test_trusted_peer_uses_forwarded_header(trusted):
    request = fake_request("10.0.0.1", xff="203.0.113.5")
    assert client_key(request) == "203.0.113.5"


def test_forwarded_header_read_right_to_left(trusted):
    # nginx-style: $proxy_add_x_forwarded_for appends, so a client-supplied
    # value sits on the left. Taking the first entry would be spoofable.
    request = fake_request("10.0.0.1", xff="9.9.9.9, 203.0.113.5")
    assert client_key(request) == "203.0.113.5"


def test_chained_trusted_proxies_walk_past_all_of_them(trusted):
    request = fake_request("10.0.0.1", xff="203.0.113.5, 10.0.0.5")
    assert client_key(request) == "203.0.113.5"


def test_forwarded_header_entirely_trusted_falls_back_to_peer(trusted):
    request = fake_request("10.0.0.1", xff="10.0.0.5, 172.16.0.9")
    assert client_key(request) == "10.0.0.1"


def test_unparseable_peer_is_treated_as_untrusted(trusted):
    # e.g. Starlette's TestClient uses the literal peer "testclient".
    request = fake_request("testclient", xff="203.0.113.5")
    assert client_key(request) == "testclient"


def test_missing_client_falls_back_to_a_constant(trusted):
    request = fake_request(None)
    assert client_key(request) == "unknown"


def test_no_forwarded_header_uses_peer_even_when_trusted(trusted):
    request = fake_request("10.0.0.1")
    assert client_key(request) == "10.0.0.1"
