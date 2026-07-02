#!/usr/bin/env python3
"""
One-time migration: import funds + transactions from
server/database/active_funds/*.csv and deleted_funds/*.csv into the
PostgreSQL funds/transactions tables.

Run this AFTER applying SQL migrations (migrate.py).

Usage:
    cd personal-finance
    uv run --project rag python database/migrate_funds_from_csv.py

Safe to re-run — upserts by legacy_id and replaces each fund's transaction
set in one transaction per fund.
"""

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


def parse_csv(csv_text: str, legacy_id: str) -> dict:
    """Mirrors server.js's csvToFund: line 1 is the transactions header
    marker comment, line 2 is metadata, then a blank line, '#Transactions',
    a header row, then one row per transaction."""
    lines = csv_text.split("\n")
    metadata_line = lines[1]
    fund_id, name, fund_type, current_nav = metadata_line.split(",")
    name = name.strip('"')

    transactions = []
    header_index = next(
        (i for i, line in enumerate(lines) if line.startswith("date,amount,nav,units")),
        -1,
    )
    if header_index != -1:
        for line in lines[header_index + 1 :]:
            if not line.strip():
                continue
            date, amount, nav, units = line.split(",")
            transactions.append(
                {"date": date, "amount": float(amount), "nav": float(nav), "units": float(units)}
            )

    return {
        "legacy_id": legacy_id,
        "name": name,
        "type": fund_type,
        "current_nav": float(current_nav),
        "transactions": transactions,
    }


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
        print("  cd personal-finance/rag && uv run python ../database/migrate_funds_from_csv.py")
        sys.exit(1)

    active_dir = repo_root / "server" / "database" / "active_funds"
    deleted_dir = repo_root / "server" / "database" / "deleted_funds"

    funds = []
    for csv_file in sorted(active_dir.glob("*.csv")):
        funds.append((parse_csv(csv_file.read_text(), csv_file.stem), False))
    for csv_file in sorted(deleted_dir.glob("*.csv")):
        funds.append((parse_csv(csv_file.read_text(), csv_file.stem), True))

    if not funds:
        print(f"No fund CSVs found in {active_dir} or {deleted_dir} — nothing to import.")
        return

    conn = psycopg2.connect(database_url)
    cur = conn.cursor()

    total_transactions = 0
    try:
        for fund, is_deleted in funds:
            cur.execute(
                """
                INSERT INTO funds (legacy_id, name, type, current_nav, deleted_at)
                VALUES (%s, %s, %s, %s, CASE WHEN %s THEN NOW() ELSE NULL END)
                ON CONFLICT (legacy_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    type = EXCLUDED.type,
                    current_nav = EXCLUDED.current_nav,
                    deleted_at = EXCLUDED.deleted_at,
                    updated_at = NOW()
                RETURNING id
                """,
                (fund["legacy_id"], fund["name"], fund["type"], fund["current_nav"], is_deleted),
            )
            fund_id = cur.fetchone()[0]

            cur.execute("DELETE FROM transactions WHERE fund_id = %s", (fund_id,))
            for t in fund["transactions"]:
                cur.execute(
                    """
                    INSERT INTO transactions (fund_id, date, amount, nav, units)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (fund_id, t["date"], t["amount"], t["nav"], t["units"]),
                )
                total_transactions += 1

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    print(f"Imported {len(funds)} fund(s) and {total_transactions} transaction(s) from CSV.")


if __name__ == "__main__":
    main()
