from collections.abc import Iterator

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import get_settings

_engine: Engine | None = None
_SessionLocal: sessionmaker[Session] | None = None


def get_engine() -> Engine:
    """Engine bound to the read-only role. The API never gets write privileges."""
    global _engine, _SessionLocal
    if _engine is None:
        _engine = create_engine(
            get_settings().readonly_dsn, pool_pre_ping=True, pool_size=5
        )
        _SessionLocal = sessionmaker(bind=_engine)
    return _engine


def get_session() -> Iterator[Session]:
    get_engine()
    assert _SessionLocal is not None
    with _SessionLocal() as session:
        yield session
