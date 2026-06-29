"""CRUD for the documents table — replaces the JSON-file deduplicator."""

from __future__ import annotations

from typing import Any

import psycopg2.extras

from backend.db.connection import get_conn

# Columns we allow in update(); unknown kwargs are silently ignored.
_UPDATABLE = {
    "status", "doc_type", "institution", "period_start", "period_end",
    "currency", "file_path", "chunk_count", "error_message",
}


def _row_to_dict(row: dict) -> dict:
    """Normalise DB row to the dict shape the rest of the code expects."""
    d = dict(row)
    # period dates come back as Python date objects; serialise to strings
    for key in ("period_start", "period_end", "ingested_at"):
        if d.get(key) is not None:
            d[key] = str(d[key])
    return d


def find_by_hash(file_hash: str) -> dict | None:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT id AS doc_id, * FROM documents WHERE file_hash = %s",
            (file_hash,),
        )
        row = cur.fetchone()
        return _row_to_dict(row) if row else None


def find_by_id(doc_id: str) -> dict | None:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT id AS doc_id, * FROM documents WHERE id = %s",
            (doc_id,),
        )
        row = cur.fetchone()
        return _row_to_dict(row) if row else None


def list_all() -> list[dict]:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT id AS doc_id, * FROM documents "
            "WHERE status != 'deleted' ORDER BY ingested_at DESC"
        )
        return [_row_to_dict(r) for r in cur.fetchall()]


def register(file_hash: str, filename: str) -> str:
    """Insert a new document row in 'processing' state. Returns the new doc_id."""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO documents (file_hash, filename, status)
            VALUES (%s, %s, 'processing')
            RETURNING id
            """,
            (file_hash, filename),
        )
        doc_id = str(cur.fetchone()[0])
        conn.commit()
        return doc_id


def update(doc_id: str, **kwargs: Any) -> None:
    """Update any subset of updatable columns on a document row."""
    # Map 'error' kwarg (legacy name from pipeline.py) to the DB column name
    if "error" in kwargs:
        kwargs["error_message"] = kwargs.pop("error")

    fields = {k: v for k, v in kwargs.items() if k in _UPDATABLE}
    if not fields:
        return

    set_clause = ", ".join(f"{col} = %s" for col in fields)
    values = list(fields.values()) + [doc_id]

    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            f"UPDATE documents SET {set_clause} WHERE id = %s",
            values,
        )
        conn.commit()
