"""CRUD for chat_sessions, chat_messages, and chat_sources."""

from __future__ import annotations

import psycopg2.extras

from backend.db.connection import get_conn


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

def get_or_create_session(session_id: str | None, first_question: str) -> str:
    """Return an existing session_id or create a new session. Returns str UUID."""
    if session_id:
        with get_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE chat_sessions SET updated_at = NOW() WHERE id = %s RETURNING id",
                (session_id,),
            )
            row = cur.fetchone()
            conn.commit()
            if row:
                return str(row[0])
            # session_id provided but not found — fall through to create

    title = first_question[:80].strip()
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO chat_sessions (title) VALUES (%s) RETURNING id",
            (title,),
        )
        new_id = str(cur.fetchone()[0])
        conn.commit()
        return new_id


def list_sessions() -> list[dict]:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT id, title, created_at, updated_at "
            "FROM chat_sessions ORDER BY updated_at DESC"
        )
        return [dict(r) for r in cur.fetchall()]


def get_session(session_id: str) -> dict | None:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT id, title, created_at, updated_at "
            "FROM chat_sessions WHERE id = %s",
            (session_id,),
        )
        row = cur.fetchone()
        return dict(row) if row else None


def delete_session(session_id: str) -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM chat_sessions WHERE id = %s", (session_id,))
        conn.commit()


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------

def create_message(
    session_id: str,
    role: str,
    content: str,
    rewritten_query: str | None = None,
    best_rerank_score: float | None = None,
    institution_filter: str | None = None,
    period_filter: str | None = None,
) -> str:
    """Insert a message row. Returns the new message_id as a string."""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO chat_messages
                (session_id, role, content, rewritten_query, best_rerank_score,
                 institution_filter, period_filter)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (session_id, role, content, rewritten_query, best_rerank_score,
             institution_filter, period_filter),
        )
        msg_id = str(cur.fetchone()[0])
        conn.commit()
        return msg_id


def list_messages(session_id: str) -> list[dict]:
    """Return all messages for a session, each with its sources list embedded."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM chat_messages WHERE session_id = %s ORDER BY created_at",
            (session_id,),
        )
        messages = [dict(r) for r in cur.fetchall()]

    for msg in messages:
        msg["sources"] = get_message_sources(str(msg["id"]))

    return messages


# ---------------------------------------------------------------------------
# Sources
# ---------------------------------------------------------------------------

def create_sources(message_id: str, candidates: list[dict]) -> None:
    """Persist the reranked source chunks used to generate an assistant answer."""
    if not candidates:
        return

    rows = []
    for i, c in enumerate(candidates, 1):
        rows.append((
            message_id,
            c.get("doc_id") or None,  # FK to documents.id
            c.get("institution"),
            c.get("period"),
            c.get("section"),
            c.get("text"),
            c.get("rerank_score"),
            i,  # position
        ))

    with get_conn() as conn:
        cur = conn.cursor()
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO chat_sources
                (message_id, document_id, institution, period, section,
                 chunk_text, rerank_score, position)
            VALUES %s
            """,
            rows,
        )
        conn.commit()


def get_message_sources(message_id: str) -> list[dict]:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM chat_sources WHERE message_id = %s ORDER BY position",
            (message_id,),
        )
        return [dict(r) for r in cur.fetchall()]
