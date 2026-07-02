"""Fund lookups and nav_history writes for the price-scraper service."""

from __future__ import annotations

from datetime import date

import psycopg2.extras

from backend.db.connection import get_conn


def get_owned_funds() -> list[dict]:
    """Non-deleted funds, id + name — the only funds we ever write prices for."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id, name FROM funds WHERE deleted_at IS NULL")
        return [dict(r) for r in cur.fetchall()]


def get_latest_nav_date(fund_id: str) -> date | None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT max(date) FROM nav_history WHERE fund_id = %s", (fund_id,))
        row = cur.fetchone()
        return row[0] if row else None


def get_alias_map(source: str) -> dict[str, str]:
    """external_name -> fund_id, for a given source (e.g. 'utasl')."""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT external_name, fund_id FROM fund_name_aliases WHERE source = %s", (source,))
        return {row[0]: row[1] for row in cur.fetchall()}


def resolve_fund_id(external_name: str, alias_map: dict[str, str], owned_funds: list[dict]) -> str | None:
    """Match an external fund name to one of our owned funds.

    Checks the alias table first (exact match on the external string), then
    falls back to a case-insensitive/trimmed match against funds.name.
    Returns None if nothing matches — the caller should skip the row silently
    (this is price data for fund we don't hold, not a data-entry mistake).
    """
    if external_name in alias_map:
        return alias_map[external_name]

    normalized = external_name.strip().lower()
    for fund in owned_funds:
        if fund["name"].strip().lower() == normalized:
            return fund["id"]
    return None


def upsert_nav(fund_id: str, nav_date: date, nav: float) -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO nav_history (fund_id, date, nav)
            VALUES (%s, %s, %s)
            ON CONFLICT (fund_id, date) DO UPDATE SET nav = EXCLUDED.nav
            """,
            (fund_id, nav_date, nav),
        )
        conn.commit()
