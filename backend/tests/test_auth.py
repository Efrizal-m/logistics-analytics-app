"""Pure unit tests for token minting/verification and the credential check.

No server, no Postgres - same reasoning as test_ratelimit.py: these run even
when the database fixture in conftest.py would skip the rest of the suite.
Settings are driven through real env vars + get_settings.cache_clear(),
matching test_api.py's _set_limits() convention, rather than stubbing out
Settings entirely - the thing under test is the interaction between config
and the signing/verification logic, not just the logic in isolation.
"""

from __future__ import annotations

import time

import pytest

from app.auth import check_credentials, mint_token, verify_token
from app.config import get_settings


@pytest.fixture(autouse=True)
def configured_auth(monkeypatch):
    monkeypatch.setenv("AUTH_ENABLED", "true")
    monkeypatch.setenv("AUTH_USERNAME", "admin")
    monkeypatch.setenv("AUTH_PASSWORD", "correct-horse")
    monkeypatch.setenv("AUTH_SECRET", "test-secret-do-not-use-in-prod-0123456789")
    monkeypatch.setenv("AUTH_SESSION_HOURS", "12")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


# --- mint/verify round trip --------------------------------------------------


def test_a_freshly_minted_token_verifies_to_its_username():
    token = mint_token("admin")
    assert verify_token(token) == "admin"


def test_expired_token_is_rejected(monkeypatch):
    monkeypatch.setenv("AUTH_SESSION_HOURS", "0")
    get_settings.cache_clear()
    token = mint_token("admin")
    time.sleep(0.01)  # exp was "now" at mint time; any elapsed time is enough
    assert verify_token(token) is None


def test_tampered_payload_is_rejected():
    token = mint_token("admin")
    payload, signature = token.split(".")
    # Flip one character - still valid base64 shape, wrong signature.
    flipped = ("a" if payload[-1] != "a" else "b") + payload[1:]
    assert verify_token(f"{flipped}.{signature}") is None


def test_tampered_signature_is_rejected():
    token = mint_token("admin")
    payload, signature = token.split(".")
    flipped = ("a" if signature[-1] != "a" else "b") + signature[1:]
    assert verify_token(f"{payload}.{flipped}") is None


def test_token_signed_with_a_different_secret_is_rejected(monkeypatch):
    token = mint_token("admin")
    monkeypatch.setenv("AUTH_SECRET", "a-completely-different-secret")
    get_settings.cache_clear()
    assert verify_token(token) is None


@pytest.mark.parametrize(
    "malformed",
    [
        "",
        "not-a-token",
        "only.one.dot.too.many",
        "bm90LXZhbGlkLWpzb24=.c2ln",  # valid base64, payload isn't JSON
    ],
)
def test_malformed_tokens_are_rejected(malformed):
    assert verify_token(malformed) is None


# --- credential check ---------------------------------------------------


def test_correct_credentials_pass():
    assert check_credentials("admin", "correct-horse") is True


def test_wrong_username_fails():
    assert check_credentials("someone-else", "correct-horse") is False


def test_wrong_password_fails():
    assert check_credentials("admin", "wrong") is False


def test_both_wrong_fails():
    assert check_credentials("nope", "nope") is False


# --- fail-closed configuration -------------------------------------------


@pytest.mark.parametrize(
    "missing",
    ["AUTH_USERNAME", "AUTH_PASSWORD", "AUTH_SECRET"],
)
def test_auth_configured_is_false_if_any_field_is_missing(monkeypatch, missing):
    monkeypatch.setenv(missing, "")
    get_settings.cache_clear()
    assert get_settings().auth_configured is False
