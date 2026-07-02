"""DB access for the deposit-parser: fund matching, dedupe, and the review queue."""

from __future__ import annotations

from datetime import date

import psycopg2.extras

from backend.db.connection import get_conn


def get_owned_funds() -> list[dict]:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT id, name FROM funds WHERE deleted_at IS NULL")
        return [dict(r) for r in cur.fetchall()]


def get_alias_map(source: str) -> dict[str, str]:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT external_name, fund_id FROM fund_name_aliases WHERE source = %s", (source,))
        return {row[0]: row[1] for row in cur.fetchall()}


def resolve_fund_id(external_name: str, alias_map: dict[str, str], owned_funds: list[dict]) -> str | None:
    if external_name in alias_map:
        return alias_map[external_name]
    normalized = external_name.strip().lower()
    for fund in owned_funds:
        if fund["name"].strip().lower() == normalized:
            return fund["id"]
    return None


def is_processed(source: str, pdf_filename: str) -> bool:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT 1 FROM processed_deposit_files WHERE source = %s AND pdf_filename = %s",
            (source, pdf_filename),
        )
        return cur.fetchone() is not None


def find_existing_transaction(fund_id: str, txn_date: date, amount: float) -> str | None:
    """Dedupe key is fund + amount + date within a few days, not an exact row
    match: PDF confirmation letters show a rounded 'units' display value that
    won't bit-match the precisely-computed value already in the ledger (e.g.
    from a CSV migration), AND a letter's issued_date consistently landed a
    day after the actual transaction date in a real batch we hit — every
    PDF's issued_date was exactly +1 day off the matching CSV-migrated row.
    A tight window absorbs that drift without being loose enough to conflate
    two genuinely different purchases."""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id FROM transactions
            WHERE fund_id = %s AND amount = %s
              AND date BETWEEN %s::date - INTERVAL '3 days' AND %s::date + INTERVAL '3 days'
            ORDER BY abs(date - %s::date)
            LIMIT 1
            """,
            (fund_id, amount, txn_date, txn_date, txn_date),
        )
        row = cur.fetchone()
        return row[0] if row else None


def insert_transaction(fund_id: str, txn_date: date, amount: float, nav: float, units: float) -> str:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO transactions (fund_id, date, amount, nav, units) VALUES (%s, %s, %s, %s, %s) RETURNING id",
            (fund_id, txn_date, amount, nav, units),
        )
        txn_id = cur.fetchone()[0]
        conn.commit()
        return txn_id


def record_processed_file(
    source: str,
    pdf_filename: str,
    parsed_fund_name: str,
    fund_id: str | None,
    transaction_id: str | None,
    status: str,
    issued_date: date | None,
    amount: float | None,
    nav: float | None,
    units: float | None,
) -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO processed_deposit_files
                (source, pdf_filename, parsed_fund_name, fund_id, transaction_id, status, issued_date, amount, nav, units)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (source, pdf_filename) DO UPDATE SET
                fund_id = EXCLUDED.fund_id,
                transaction_id = EXCLUDED.transaction_id,
                status = EXCLUDED.status
            """,
            (source, pdf_filename, parsed_fund_name, fund_id, transaction_id, status, issued_date, amount, nav, units),
        )
        conn.commit()


def list_pending() -> list[dict]:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            """
            SELECT id, source, pdf_filename, parsed_fund_name, issued_date, amount, nav, units, created_at
            FROM processed_deposit_files WHERE status = 'pending' ORDER BY created_at
            """
        )
        return [dict(r) for r in cur.fetchall()]


def get_pending(review_id: str) -> dict | None:
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute("SELECT * FROM processed_deposit_files WHERE id = %s AND status = 'pending'", (review_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def list_pending_with_name(source: str, parsed_fund_name: str) -> list[dict]:
    """Other pending rows sharing the same external name — mapping one should
    resolve all of them, since they're all instances of the same unresolved-name
    problem the user is fixing right now, not independent decisions."""
    with get_conn() as conn:
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(
            "SELECT * FROM processed_deposit_files WHERE source = %s AND parsed_fund_name = %s AND status = 'pending'",
            (source, parsed_fund_name),
        )
        return [dict(r) for r in cur.fetchall()]


def add_alias(external_name: str, source: str, fund_id: str) -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO fund_name_aliases (external_name, source, fund_id)
            VALUES (%s, %s, %s)
            ON CONFLICT (external_name, source) DO UPDATE SET fund_id = EXCLUDED.fund_id
            """,
            (external_name, source, fund_id),
        )
        conn.commit()


def resolve_pending(review_id: str, fund_id: str, transaction_id: str) -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE processed_deposit_files SET fund_id = %s, transaction_id = %s, status = 'inserted' WHERE id = %s",
            (fund_id, transaction_id, review_id),
        )
        conn.commit()
