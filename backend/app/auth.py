"""A single shared login for the whole app.

Stdlib only - hmac/hashlib for the signature, secrets/base64 for encoding - to
match how the rate limiter and cache are hand-rolled elsewhere in this project
rather than reached for as a dependency. The token is a stateless, signed
{username, exp} pair: no server-side session store, so a login survives a
container restart and works across multiple uvicorn workers, unlike an
in-memory session dict.

Fails closed. auth_enabled defaults to True, and if it is on but any of
username/password/secret is unset, every protected endpoint answers 503
rather than quietly serving the app to anyone - a misconfigured deploy must
serve nothing, not everything. This is the one place in the config where an
empty-string default (the pattern anthropic_api_key uses to degrade
gracefully) would be actively dangerous.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time

from fastapi import HTTPException, Request

from app.config import get_settings


def _b64encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64decode(text: str) -> bytes:
    padding = "=" * (-len(text) % 4)
    return base64.urlsafe_b64decode(text + padding)


def _sign(payload: bytes, secret: str) -> bytes:
    return hmac.new(secret.encode("utf-8"), payload, hashlib.sha256).digest()


def mint_token(username: str) -> str:
    settings = get_settings()
    payload = json.dumps(
        {"u": username, "exp": time.time() + settings.auth_session_hours * 3600}
    ).encode("utf-8")
    signature = _sign(payload, settings.auth_secret)
    return f"{_b64encode(payload)}.{_b64encode(signature)}"


def verify_token(token: str) -> str | None:
    """Returns the username if `token` is well-formed, correctly signed with
    the current auth_secret, and not expired. Returns None for anything else
    - tampered payload, tampered signature, wrong secret, malformed input,
    expired - callers only need the yes/no plus the identity."""
    try:
        encoded_payload, encoded_signature = token.split(".")
        payload = _b64decode(encoded_payload)
        signature = _b64decode(encoded_signature)
    except ValueError:
        # Wrong number of "."-parts, or invalid base64 (binascii.Error is a
        # ValueError subclass) - either way, not a token this code minted.
        return None

    expected = _sign(payload, get_settings().auth_secret)
    if not hmac.compare_digest(signature, expected):
        return None

    try:
        data = json.loads(payload)
        username = data["u"]
        expires_at = data["exp"]
    except (KeyError, ValueError, TypeError):
        return None

    if not isinstance(username, str) or time.time() >= expires_at:
        return None
    return username


def check_credentials(username: str, password: str) -> bool:
    """Constant-time-ish: both fields are compared even when the username is
    already wrong, so response time can't be used to probe which half of a
    guess was incorrect."""
    settings = get_settings()
    username_ok = hmac.compare_digest(username, settings.auth_username)
    password_ok = hmac.compare_digest(password, settings.auth_password)
    return username_ok and password_ok


async def require_auth(request: Request) -> str:
    """The dependency every protected route carries. A plain FastAPI
    dependency, not middleware - its HTTPException travels back out through
    CORSMiddleware and keeps the ACAO header, the same reason app/ratelimit.py
    raises rather than short-circuits (see that module's docstring). A pure
    ASGI middleware returning a bare 401 would reproduce the "Failed to
    fetch" bug this project already fixed once for 429s."""
    settings = get_settings()
    if not settings.auth_enabled:
        return "anonymous"
    if not settings.auth_configured:
        raise HTTPException(status_code=503, detail="Authentication is enabled but not configured.")

    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    username = verify_token(token)
    if username is None:
        raise HTTPException(
            status_code=401,
            detail="Session expired or invalid. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return username
