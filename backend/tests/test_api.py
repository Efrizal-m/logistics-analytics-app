"""End-to-end tests through FastAPI's TestClient.

This is the only place several things can be verified together: that a 429
from the rate limiter still carries CORS headers (the middleware-vs-dependency
decision in app/ratelimit.py exists specifically to guarantee this - see its
module docstring), that a 401 from app/auth.py's require_auth carries the same
CORS header for the same reason, and that the /api/ask cache actually reduces
how many times the (here, faked) model gets called.

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
from app.auth import mint_token
from app.config import get_settings
from app.main import app
from app.ratelimit import reset_limiters

TEST_USERNAME = "test-admin"
TEST_PASSWORD = "test-password"


@pytest.fixture(autouse=True)
def configured_auth(monkeypatch):
    # Every test in this file authenticates as this fixed user unless it
    # asks for `unauthenticated_client` instead - matching how the real app
    # gates everything except /health.
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("AUTH_USERNAME", TEST_USERNAME)
    monkeypatch.setenv("AUTH_PASSWORD", TEST_PASSWORD)
    monkeypatch.setenv("AUTH_SECRET", "test-secret-do-not-use-in-prod-0123456789")
    get_settings.cache_clear()


@pytest.fixture
def unauthenticated_client(engine):  # noqa: ARG001 - triggers conftest's Postgres skip guard
    return TestClient(app)


@pytest.fixture
def client(unauthenticated_client):
    token = mint_token(TEST_USERNAME)
    unauthenticated_client.headers["Authorization"] = f"Bearer {token}"
    return unauthenticated_client


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


def test_protected_endpoint_returns_401_with_cors_headers_when_unauthenticated(
    unauthenticated_client,
):
    origin = get_settings().cors_origin_list[0]
    response = unauthenticated_client.get("/api/kpis", headers={"Origin": origin})

    assert response.status_code == 401
    # Same regression this file already guards for 429s: a dependency's
    # HTTPException travels back out through CORSMiddleware and keeps the
    # header, while a middleware short-circuit would not.
    assert response.headers["access-control-allow-origin"] == origin
    assert "www-authenticate" in {k.lower() for k in response.headers}


def test_health_requires_no_authentication(unauthenticated_client):
    assert unauthenticated_client.get("/health").status_code == 200


def test_schema_endpoint_also_requires_auth(unauthenticated_client):
    # /api/schema is the one route that carries its auth dependency
    # per-endpoint rather than at the router level (it shares routes_meta's
    # router with /health, which must stay open) - easy to miss in a
    # copy-paste, so it gets its own direct check.
    assert unauthenticated_client.get("/api/schema").status_code == 401


@pytest.mark.parametrize(
    "header_value",
    [
        "Bearer not-a-real-token",
        "Bearer a.b",
        "Bearer a.b.c",
        "Bearer ",
        "Basic dXNlcjpwYXNz",
        "",
    ],
)
def test_garbage_authorization_header_is_401_not_500(unauthenticated_client, header_value):
    # The failure mode that matters here isn't "rejected" - it's "rejected
    # cleanly". Malformed input reaching an unhandled exception would become
    # a 500 that escapes CORSMiddleware, which is indistinguishable from a
    # broken deployment to the frontend (the same class of bug the 429 tests
    # above guard against for the rate limiter).
    origin = get_settings().cors_origin_list[0]
    headers = {"Origin": origin}
    if header_value:
        headers["Authorization"] = header_value
    response = unauthenticated_client.get("/api/kpis", headers=headers)
    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == origin


def test_login_with_correct_credentials_returns_a_usable_token(unauthenticated_client):
    response = unauthenticated_client.post(
        "/api/login", json={"username": TEST_USERNAME, "password": TEST_PASSWORD}
    )
    assert response.status_code == 200
    token = response.json()["token"]

    followup = unauthenticated_client.get(
        "/api/kpis", headers={"Authorization": f"Bearer {token}"}
    )
    assert followup.status_code == 200


def test_login_with_wrong_password_is_rejected(unauthenticated_client, monkeypatch):
    _set_limits(monkeypatch, LOGIN_RATE_LIMIT_REQUESTS=10, LOGIN_RATE_LIMIT_WINDOW_SECONDS=3600)
    response = unauthenticated_client.post(
        "/api/login", json={"username": TEST_USERNAME, "password": "wrong"}
    )
    assert response.status_code == 401


def test_repeated_bad_logins_are_rate_limited(unauthenticated_client, monkeypatch):
    _set_limits(monkeypatch, LOGIN_RATE_LIMIT_REQUESTS=2, LOGIN_RATE_LIMIT_WINDOW_SECONDS=3600)
    body = {"username": TEST_USERNAME, "password": "wrong"}

    for _ in range(2):
        response = unauthenticated_client.post("/api/login", json=body)
        assert response.status_code == 401

    response = unauthenticated_client.post("/api/login", json=body)
    assert response.status_code == 429
