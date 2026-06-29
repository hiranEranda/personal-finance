"""Shared psycopg2 connection pool for the RAG backend."""

from __future__ import annotations

import logging
from contextlib import contextmanager
from typing import Generator

import psycopg2
import psycopg2.extras
from psycopg2.pool import ThreadedConnectionPool

from backend.config import settings

logger = logging.getLogger("backend.db")

_pool: ThreadedConnectionPool | None = None


def init_pool() -> None:
    global _pool
    logger.info("[DB      ] Initialising connection pool...")
    _pool = ThreadedConnectionPool(1, 5, settings.database_url)
    logger.info("[DB      ] Pool ready")


def close_pool() -> None:
    global _pool
    if _pool:
        _pool.closeall()
        _pool = None


@contextmanager
def get_conn() -> Generator[psycopg2.extensions.connection, None, None]:
    """Context manager that borrows a connection from the pool and returns it."""
    assert _pool is not None, "DB pool not initialised — call init_pool() first"
    conn = _pool.getconn()
    try:
        yield conn
    except Exception:
        conn.rollback()
        raise
    finally:
        _pool.putconn(conn)
