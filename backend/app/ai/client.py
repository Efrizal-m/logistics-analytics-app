from __future__ import annotations

from functools import lru_cache

import anthropic

from app.config import get_settings


class AnthropicUnavailable(RuntimeError):
    """No API key configured. The dashboard still works; /api/ask does not."""


@lru_cache
def get_client() -> anthropic.Anthropic:
    settings = get_settings()
    if not settings.anthropic_api_key:
        raise AnthropicUnavailable(
            "ANTHROPIC_API_KEY is not set. The dashboard endpoints work without "
            "it; natural-language questions need a key."
        )
    return anthropic.Anthropic(api_key=settings.anthropic_api_key)


def is_configured() -> bool:
    return bool(get_settings().anthropic_api_key)
