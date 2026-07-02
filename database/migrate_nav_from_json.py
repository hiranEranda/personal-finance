#!/usr/bin/env python3
"""
One-time migration: import NAV history from server/database/nav_history.json
into the PostgreSQL nav_history/yearly_performance tables, and backfill
funds.category / funds.management_company.

Run this AFTER migrate_funds_from_csv.py — it joins on funds.legacy_id, which
that script populates.

Usage:
    cd personal-finance
    uv run --project rag python database/migrate_nav_from_json.py

Safe to re-run — replaces each fund's nav_history/yearly_performance rows in
one transaction per fund.
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
        print("  cd personal-finance/rag && uv run python ../database/migrate_nav_from_json.py")
        sys.exit(1)

    json_path = repo_root / "server" / "database" / "nav_history.json"
    if not json_path.exists():
        print(f"No nav_history.json found at {json_path} — nothing to import.")
        return

    data = json.loads(json_path.read_text())

    conn = psycopg2.connect(database_url)
    cur = conn.cursor()

    funds_updated = 0
    nav_rows = 0
    yearly_rows = 0
    skipped = []
    try:
        for legacy_id, entry in data.items():
            cur.execute("SELECT id FROM funds WHERE legacy_id = %s", (legacy_id,))
            row = cur.fetchone()
            if not row:
                skipped.append(legacy_id)
                continue
            fund_id = row[0]

            fund_info = entry.get("fund_info", {})
            cur.execute(
                """
                UPDATE funds SET category = %s, management_company = %s, updated_at = NOW()
                WHERE id = %s
                """,
                (fund_info.get("category"), fund_info.get("management_company"), fund_id),
            )
            funds_updated += 1

            cur.execute("DELETE FROM nav_history WHERE fund_id = %s", (fund_id,))
            for m in entry.get("monthly_performance", []):
                cur.execute(
                    """
                    INSERT INTO nav_history (fund_id, date, nav, return_pct)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (fund_id, date) DO NOTHING
                    """,
                    (fund_id, m["date"], m["nav"], m.get("return_pct")),
                )
                nav_rows += 1

            cur.execute("DELETE FROM yearly_performance WHERE fund_id = %s", (fund_id,))
            for year, return_pct in entry.get("yearly_performance", {}).items():
                cur.execute(
                    """
                    INSERT INTO yearly_performance (fund_id, year, return_pct)
                    VALUES (%s, %s, %s)
                    ON CONFLICT (fund_id, year) DO NOTHING
                    """,
                    (fund_id, int(year), return_pct),
                )
                yearly_rows += 1

        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

    print(
        f"Updated {funds_updated} fund(s), imported {nav_rows} nav_history row(s) and "
        f"{yearly_rows} yearly_performance row(s)."
    )
    if skipped:
        print(f"Skipped {len(skipped)} legacy_id(s) with no matching fund: {skipped}")


if __name__ == "__main__":
    main()
