from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    postgres_db: str = "logistics"
    postgres_user: str = "logistics_owner"
    postgres_password: str = "logistics"
    postgres_host: str = "localhost"
    postgres_port: int = 5432

    readonly_user: str = "logistics_ro"
    readonly_password: str = "logistics_ro"

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-opus-5"

    cors_origins: str = "http://localhost:5173"

    # Comma-separated IPs/CIDRs whose X-Forwarded-For header is believed. The
    # default covers loopback and the RFC1918 ranges Docker hands out, which is
    # exactly the reverse-proxy case, and never believes a client that connected
    # to us directly from a public address.
    trusted_proxies: str = "127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"

    rate_limit_enabled: bool = True
    ask_rate_limit_requests: int = 10
    ask_rate_limit_window_seconds: int = 3600
    dashboard_rate_limit_requests: int = 60
    dashboard_rate_limit_window_seconds: int = 60
    rate_limit_max_clients: int = 10_000

    cache_enabled: bool = True
    cache_ttl_seconds: int = 300
    ask_cache_max_entries: int = 128

    # A single shared login gates every endpoint except /health. No users
    # table - the API's database role only holds SELECT, and a login table
    # would need write access for one row of config. If auth_enabled is true,
    # every one of username/password/secret must be set (and the secret long
    # enough to actually resist forgery) or every protected endpoint fails
    # closed with a 503 rather than silently serving the app open (unlike
    # anthropic_api_key, which is allowed to default empty and degrade
    # gracefully - an unconfigured login must never mean "no login").
    auth_enabled: bool = True
    auth_username: str = ""
    auth_password: str = ""
    # HMAC signing key for session tokens. Generate with: openssl rand -hex 32
    auth_secret: str = ""
    auth_session_hours: int = 12
    login_rate_limit_requests: int = 5
    login_rate_limit_window_seconds: int = 900

    @property
    def auth_configured(self) -> bool:
        # >= 32 chars, not just non-empty: an AUTH_SECRET of "changeme" would
        # pass a bare truthiness check and mint tokens anyone could forge by
        # brute-forcing the HMAC key. openssl rand -hex 32 yields 64.
        return bool(
            self.auth_username and self.auth_password and len(self.auth_secret) >= 32
        )

    @property
    def owner_dsn(self) -> str:
        """Full-privilege DSN, used only by the seed script."""
        return (
            f"postgresql+psycopg://{self.postgres_user}:{self.postgres_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def readonly_dsn(self) -> str:
        """The DSN the API runs on. This role only holds SELECT on orders."""
        return (
            f"postgresql+psycopg://{self.readonly_user}:{self.readonly_password}"
            f"@{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def trusted_proxy_list(self) -> list[str]:
        return [p.strip() for p in self.trusted_proxies.split(",") if p.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
