from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app.auth import check_credentials, mint_token
from app.config import get_settings
from app.ratelimit import login_rate_limit

router = APIRouter(prefix="/api", dependencies=[Depends(login_rate_limit)])


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=200)


class LoginResponse(BaseModel):
    token: str
    username: str
    expires_at: str


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, response: Response) -> LoginResponse:
    settings = get_settings()
    if not settings.auth_configured:
        raise HTTPException(status_code=503, detail="Authentication is enabled but not configured.")

    # Generic message on failure - it does not say which of username/password
    # was wrong, matching check_credentials()'s constant-time comparison of
    # both fields regardless of which one already failed.
    if not check_credentials(payload.username, payload.password):
        raise HTTPException(status_code=401, detail="Invalid username or password.")

    # Belt-and-braces: a token is a bearer credential, so make sure no
    # intermediary (proxy, browser back-forward cache) is tempted to cache it.
    response.headers["Cache-Control"] = "no-store"

    token = mint_token(payload.username)
    expires_at = time.time() + settings.auth_session_hours * 3600
    return LoginResponse(
        token=token,
        username=payload.username,
        expires_at=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(expires_at)),
    )
