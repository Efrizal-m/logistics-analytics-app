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


@lru_cache
def get_settings() -> Settings:
    return Settings()
