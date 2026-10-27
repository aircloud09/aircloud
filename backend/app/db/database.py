import logging
from collections.abc import AsyncIterator
from typing import Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool, Pool, StaticPool

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()


def _set_sqlite_pragma(dbapi_connection: Any, _connection_record: Any) -> None:
    """Enable WAL mode and busy timeout on every SQLite connection.

    WAL mode allows concurrent readers alongside a single writer, which
    prevents the "database is locked" errors that occur when multiple
    async tasks (hook events, pollers, git service) write concurrently.
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


def _pool_class_for(url: str) -> type[Pool]:
    """Pick the connection pool for a SQLite URL.

    Hook events are persisted by concurrent background tasks. Sharing one
    connection across every session (StaticPool) interleaves their
    transactions: one task's commit or rollback lands on another task's
    half-written rows, so sessions and events silently disappear
    (StaleDataError / NoResultFound). A file database therefore opens a
    connection per session (NullPool) and lets WAL + busy_timeout serialize
    the writers; with no pool there is also nothing to exhaust, which was the
    reason StaticPool replaced QueuePool. An in-memory database only exists on
    its one connection, so it keeps StaticPool.
    """
    return StaticPool if ":memory:" in url else NullPool


def create_engine_for(url: str) -> AsyncEngine:
    """Create the async SQLite engine the app runs on for ``url``."""
    engine = create_async_engine(
        url,
        echo=False,
        connect_args={"check_same_thread": False, "timeout": 15},
        poolclass=_pool_class_for(url),
    )
    event.listen(engine.sync_engine, "connect", _set_sqlite_pragma)
    return engine


_engine: AsyncEngine = create_engine_for(settings.DATABASE_URL)


_session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    bind=_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Base class for SQLAlchemy models."""

    pass


def get_engine() -> AsyncEngine:
    """Get the current database engine."""
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    """Get the current async session factory."""
    return _session_factory


def override_engine(new_engine: AsyncEngine) -> None:
    """Override the database engine and session factory for testing."""
    global _engine, _session_factory
    _engine = new_engine
    _session_factory = async_sessionmaker(
        bind=_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )


async def get_db() -> AsyncIterator[AsyncSession]:
    """Dependency for getting a database session.

    Rolls back automatically on any exception raised by the route body so
    callers no longer need a per-route ``try/except`` just to call
    ``db.rollback()`` before re-raising (ARC-024).
    """
    async with _session_factory() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


class AsyncSessionLocal:
    """Context manager for database sessions."""

    def __init__(self) -> None:
        self._session: AsyncSession | None = None

    async def __aenter__(self) -> AsyncSession:
        self._session = _session_factory()
        return self._session

    async def __aexit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        if self._session:
            if exc_type is not None:
                await self._session.rollback()
            await self._session.close()
