#!/usr/bin/env python3
"""
One-time migration: import the current Share Market Tracker dataset from
../portfolio_data.json into the PostgreSQL share_* tables.

Run this AFTER applying SQL migrations (migrate.py).

Usage:
    cd personal-finance
    uv run --project rag python database/migrate_share_market_data.py

Safe to re-run — replaces the full share_* dataset in one transaction each time,
mirroring how the Node API persists a full-document save from the frontend.
"""

import json
import os
import sys
from pathlib import Path


def _load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def main() -> None:
    here = Path(__file__).parent
    repo_root = here.parent

    _load_env_file(repo_root / "rag" / ".env")

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL not set. Add it to personal-finance/rag/.env")
        sys.exit(1)

    try:
        import psycopg2
    except ImportError:
        print("ERROR: psycopg2 not found in the current Python environment.")
        print("Run this script through the uv venv instead:")
        print("  cd personal-finance/rag && uv run python ../database/migrate_share_market_data.py")
        sys.exit(1)

    json_path = repo_root.parent / "portfolio_data.json"
    if not json_path.exists():
        print(f"No portfolio_data.json found at {json_path} — nothing to import.")
        return

    data = json.loads(json_path.read_text())

    fee_rate = data.get("meta", {}).get("assumptions", {}).get("sellSideFeeRate", 0.0112)
    sector_list = data.get("sectorList", [])
    tickers = data.get("tickers", [])
    trades = data.get("trades", [])
    sells = data.get("sells", [])
    weekly = data.get("weeklyPrices", [])

    conn = psycopg2.connect(database_url)
    cur = conn.cursor()

    try:
        cur.execute(
            """
            INSERT INTO share_settings (key, value) VALUES ('sellSideFeeRate', %s)
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """,
            (str(fee_rate),),
        )

        cur.execute("DELETE FROM share_weekly_prices")
        cur.execute("DELETE FROM share_weeks")
        cur.execute("DELETE FROM share_sells")
        cur.execute("DELETE FROM share_trades")
        cur.execute("DELETE FROM share_tickers")
        cur.execute("DELETE FROM share_sectors")

        for i, name in enumerate(sector_list):
            cur.execute(
                "INSERT INTO share_sectors (name, sort_order) VALUES (%s, %s)",
                (name, i),
            )

        for t in tickers:
            cur.execute(
                """
                INSERT INTO share_tickers
                    (ticker, company_name, exchange, sector, currency, current_price, notes)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    t["ticker"], t["companyName"], t.get("exchange", "CSE"), t.get("sector"),
                    t.get("currency", "LKR"), t["currentPrice"], t.get("notes", ""),
                ),
            )

        for t in trades:
            cur.execute(
                """
                INSERT INTO share_trades (id, ticker, buy_date, qty, buy_price, fees_total, notes)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (t["id"], t["ticker"], t["buyDate"], t["qty"], t["buyPrice"], t.get("feesTotal", 0), t.get("notes", "")),
            )

        for s in sells:
            cur.execute(
                """
                INSERT INTO share_sells (id, ticker, sell_date, qty, sell_price, commission, notes)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (s["id"], s["ticker"], s["sellDate"], s["qty"], s["sellPrice"], s.get("commission", 0), s.get("notes", "")),
            )

        for w in weekly:
            cur.execute("INSERT INTO share_weeks (week_ending) VALUES (%s)", (w["weekEnding"],))
            for ticker, price in w.get("prices", {}).items():
                cur.execute(
                    "INSERT INTO share_weekly_prices (week_ending, ticker, price) VALUES (%s, %s, %s)",
                    (w["weekEnding"], ticker, price),
                )

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    print(
        f"Imported {len(tickers)} tickers, {len(trades)} trades, {len(sells)} sells, "
        f"{len(sector_list)} sectors, {len(weekly)} weekly price rows from portfolio_data.json"
    )


if __name__ == "__main__":
    main()
