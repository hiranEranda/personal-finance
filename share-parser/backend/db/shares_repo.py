"""DB access for the share-parser: ticker upsert, trade/sell inserts, and the
processed-file dedupe ledger."""

from __future__ import annotations

from datetime import date

import psycopg2.extras

from backend.db.connection import get_conn


def is_processed(note_type: str, pdf_filename: str) -> bool:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT 1 FROM processed_share_files WHERE note_type = %s AND pdf_filename = %s",
            (note_type, pdf_filename),
        )
        return cur.fetchone() is not None


def record_processed_file(note_type: str, pdf_filename: str, status: str, tickers: str, detail: str | None) -> None:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO processed_share_files (note_type, pdf_filename, status, tickers, detail)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (note_type, pdf_filename) DO UPDATE SET
                status = EXCLUDED.status, tickers = EXCLUDED.tickers, detail = EXCLUDED.detail
            """,
            (note_type, pdf_filename, status, tickers, detail),
        )
        conn.commit()


def ticker_exists(ticker: str) -> bool:
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM share_tickers WHERE ticker = %s", (ticker,))
        return cur.fetchone() is not None


def ensure_ticker(ticker: str, current_price: float) -> bool:
    """Creates a bare-minimum ticker row if one doesn't already exist —
    company_name is left blank for the user to fill in manually on the Ticker
    Register tab. Never overwrites an existing ticker's fields. Returns True
    if a new row was created."""
    with get_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO share_tickers (ticker, company_name, exchange, sector, currency, current_price, notes)
            VALUES (%s, '', 'CSE', NULL, 'LKR', %s, '')
            ON CONFLICT (ticker) DO NOTHING
            """,
            (ticker, current_price),
        )
        created = cur.rowcount > 0
        conn.commit()
        return created


def _next_id(cur, table: str) -> int:
    cur.execute(f"SELECT COALESCE(MAX(id), 0) + 1 FROM {table}")
    return cur.fetchone()[0]


def insert_trade(ticker: str, buy_date: date, qty: float, buy_price: float, fees_total: float, notes: str) -> int:
    with get_conn() as conn:
        cur = conn.cursor()
        trade_id = _next_id(cur, "share_trades")
        cur.execute(
            """
            INSERT INTO share_trades (id, ticker, buy_date, qty, buy_price, fees_total, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (trade_id, ticker, buy_date, qty, buy_price, fees_total, notes),
        )
        conn.commit()
        return trade_id


def insert_sell(ticker: str, sell_date: date, qty: float, sell_price: float, commission: float, notes: str) -> int:
    with get_conn() as conn:
        cur = conn.cursor()
        sell_id = _next_id(cur, "share_sells")
        cur.execute(
            """
            INSERT INTO share_sells (id, ticker, sell_date, qty, sell_price, commission, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (sell_id, ticker, sell_date, qty, sell_price, commission, notes),
        )
        conn.commit()
        return sell_id
