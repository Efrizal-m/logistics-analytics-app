"""End-to-end tests through FastAPI's TestClient.

This is the only place two things can be verified together: that a 429 from
the rate limiter still carries CORS headers (the middleware-vs-dependency
decision in app/ratelimit.py exists specifically to guarantee this - see its
module docstring), and that the /api/ask cache actually reduces how many
times the (here, faked) model gets called.

Needs a reachable, seeded Postgres like the rest of the suite - even a
request that ultimately hits the rate limiter or a cache still runs through
`Depends(get_session)` for any call that is allowed through, and the
dashboard endpoints run real queries.

Known coverage gap: Starlette's TestClient in this project's pinned version
(0.41.3) hardcodes the ASGI scope's `client` to `["testclient", 50000]` with
no way to override it, so every request in this file shares one rate-limit
identity, and `client_key()`'s trusted-proxy / X-Forwarded-For branch can
never be exercised through TestClient. That branch is covered directly in
test_ratelimit.py against synthetic Request objects, and the real proxy
behaviour has to be checked with curl against a running container (see the
plan's verification section) - TestClient cannot stand in for it.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import cache
from app.ai.router import AskResult
from app.api import routes_dashboard
from app.config import get_settings
from app.main import app
from app.ratelimit import reset_limiters


@pytest.fixture
def client(engine):  # noqa: ARG001 - requesting it triggers conftest's Postgres skip guard
    return TestClient(app)


@pytest.fixture(autouse=True)
def reset_state():
    get_settings.cache_clear()
    reset_limiters()
    cache.reset_all()
    yield
    get_settings.cache_clear()
    reset_limiters()
    cache.reset_all()


def _set_limits(monkeypatch, **env):
    for key, value in env.items():
        monkeypatch.setenv(key, str(value))
    get_settings.cache_clear()
    reset_limiters()


def test_health_is_never_rate_limited(client, monkeypatch):
    # A single-request budget on the dashboard limiter, which /health does
    # not share a router with - it must sail through regardless.
    _set_limits(monkeypatch, DASHBOARD_RATE_LIMIT_REQUESTS=1, DASHBOARD_RATE_LIMIT_WINDOW_SECONDS=3600)
    for _ in range(20):
        response = client.get("/health")
        assert response.status_code == 200


def test_dashboard_rate_limit_returns_429_with_cors_headers(client, monkeypatch):
    _set_limits(monkeypatch, DASHBOARD_RATE_LIMIT_REQUESTS=2, DASHBOARD_RATE_LIMIT_WINDOW_SECONDS=3600)
    origin = get_settings().cors_origin_list[0]

    for _ in range(2):
        response = client.get("/api/kpis", headers={"Origin": origin})
        assert response.status_code == 200

    response = client.get("/api/kpis", headers={"Origin": origin})
    assert response.status_code == 429
    # This is the regression that matters: an unhandled 500 escaping the CORS
    # middleware is exactly what made the frontend see an opaque "Failed to
    # fetch" earlier in this project. A 429 without this header would be the
    # same bug wearing a different status code.
    assert response.headers["access-control-allow-origin"] == origin
    assert "retry-after" in {k.lower() for k in response.headers}


def test_ask_rate_limit_returns_429_with_cors_headers(client, monkeypatch):
    _set_limits(monkeypatch, ASK_RATE_LIMIT_REQUESTS=1, ASK_RATE_LIMIT_WINDOW_SECONDS=3600)
    monkeypatch.setattr(
        "app.api.routes_ask.ask",
        lambda session, question, client=None: AskResult(question=question, answer="ok"),
    )
    origin = get_settings().cors_origin_list[0]
    body = {"question": "how many orders were delayed"}

    first = client.post("/api/ask", json=body, headers={"Origin": origin})
    assert first.status_code == 200

    second = client.post("/api/ask", json=body, headers={"Origin": origin})
    assert second.status_code == 429
    assert second.headers["access-control-allow-origin"] == origin
    assert "retry-after" in {k.lower() for k in second.headers}


def test_ask_cache_dedupes_normalized_repeat_questions(client, monkeypatch):
    _set_limits(monkeypatch, ASK_RATE_LIMIT_REQUESTS=10, ASK_RATE_LIMIT_WINDOW_SECONDS=3600)
    calls = []

    def fake_ask(session, question, client=None):
        calls.append(question)
        return AskResult(question=question, answer=f"answer for {question!r}")

    monkeypatch.setattr("app.api.routes_ask.ask", fake_ask)

    first = client.post("/api/ask", json={"question": "Which carrier has the highest delay rate?"})
    second = client.post(
        "/api/ask", json={"question": "  which carrier   has the highest delay rate?  "}
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert len(calls) == 1  # both normalize to the same cache key

    # Each caller sees their own exact text echoed back, not the first
    # asker's casing/whitespace - only the (cached) answer is shared.
    assert first.json()["question"] == "Which carrier has the highest delay rate?"
    assert second.json()["question"] == "which carrier   has the highest delay rate?"
    assert first.json()["answer"] == second.json()["answer"]


def test_dashboard_kpis_are_cached_across_requests(client, monkeypatch):
    calls = []
    original = routes_dashboard._build_kpis

    def spy(session):
        calls.append(1)
        return original(session)

    monkeypatch.setattr("app.api.routes_dashboard._build_kpis", spy)

    first = client.get("/api/kpis")
    second = client.get("/api/kpis")

    assert first.status_code == 200
    assert second.status_code == 200
    assert first.json() == second.json()
    assert len(calls) == 1
