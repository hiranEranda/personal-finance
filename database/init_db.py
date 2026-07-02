#!/usr/bin/env python3
"""
Create every table FinanceOS needs, from nothing.

There's no migration history to apply here — schema.sql always reflects the
current, complete schema and is safe to re-run (CREATE TABLE IF NOT EXISTS /
ON CONFLICT DO NOTHING throughout).

Usage:
    cd personal-finance
    uv run --project rag python database/init_db.py

Reads DATABASE_URL from the environment or from rag/.env if not set.
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


def main() -> None:
    here = Path(__file__).parent
    _load_env_file(here.parent / "rag" / ".env")

    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        print("ERROR: DATABASE_URL is not set.")
        print("Set it in your environment or add it to personal-finance/rag/.env")
        sys.exit(1)

    try:
        import psycopg2
    except ImportError:
        print("ERROR: psycopg2 not found in the current Python environment.")
        print("Run this script through the uv venv instead:")
        print("  cd personal-finance/rag && uv run python ../database/init_db.py")
        sys.exit(1)

    schema_sql = (here / "schema.sql").read_text()

    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    cur = conn.cursor()
    try:
        cur.execute(schema_sql)
        conn.commit()
        print("Schema created successfully.")
    except Exception as exc:
        conn.rollback()
        print(f"FAILED: {exc}")
        sys.exit(1)
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
