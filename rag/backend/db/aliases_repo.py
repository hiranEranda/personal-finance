"""CRUD for the aliases table."""

from __future__ import annotations

import psycopg2.extras

from backend.db.connection import get_conn


def list_active() -> list[dict]:
    """Return all enabled aliases as {alias, expansion, source} dicts."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT alias, expansion, source FROM aliases WHERE enabled = TRUE"
        )
        return [dict(r) for r in cur.fetchall()]


def upsert(alias: str, expansion: str, source: str = "auto") -> None:
    """Insert a new alias or update its expansion.

    Manual entries (source='manual') are never overwritten by auto-detection —
    only rows where source='auto' are updated on conflict.
    """
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO aliases (alias, expansion, source)
            VALUES (%s, %s, %s)
            ON CONFLICT (alias) DO UPDATE
                SET expansion = EXCLUDED.expansion
                WHERE aliases.source = 'auto'
            """,
            (alias.lower(), expansion, source),
        )
        conn.commit()
