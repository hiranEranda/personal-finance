#!/usr/bin/env python3
"""
Apply pending SQL migrations from this directory to PostgreSQL.

Usage:
    cd personal-finance
    python database/migrate.py

Reads DATABASE_URL from the environment or from rag/.env if not set.
Migration files are applied in filename order (001_*.sql, 002_*.sql, …).
Already-applied migrations are tracked in the schema_migrations table and skipped.
"""

import os
import sys
from pathlib import Path


def _load_env_file(path: Path) -> None:
    """Parse a .env file and set any missing env vars."""
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


def _get_database_url() -> str:
    here = Path(__file__).parent
    _load_env_file(here.parent / "rag" / ".env")
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL is not set.")
        print("Set it in your environment or add it to personal-finance/rag/.env")
        sys.exit(1)
    return url


def main() -> None:
    try:
        import psycopg2
    except ImportError:
        print("ERROR: psycopg2 not found in the current Python environment.")
        print("Run this script through the uv venv instead:")
        print("  cd personal-finance/rag && uv run python ../database/migrate.py")
        sys.exit(1)

    database_url = _get_database_url()
    migrations_dir = Path(__file__).parent

    sql_files = sorted(migrations_dir.glob("[0-9][0-9][0-9]_*.sql"))
    if not sql_files:
        print("No migration files found.")
        return

    conn = psycopg2.connect(database_url)
    conn.autocommit = False
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename   TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    conn.commit()

    cur.execute("SELECT filename FROM schema_migrations")
    applied = {row[0] for row in cur.fetchall()}

    pending = [f for f in sql_files if f.name not in applied]
    if not pending:
        print("All migrations already applied.")
        cur.close()
        conn.close()
        return

    for sql_file in pending:
        print(f"  Applying {sql_file.name} ...", end=" ")
        sql = sql_file.read_text()
        try:
            cur.execute(sql)
            cur.execute(
                "INSERT INTO schema_migrations (filename) VALUES (%s)",
                (sql_file.name,),
            )
            conn.commit()
            print("done")
        except Exception as exc:
            conn.rollback()
            print(f"FAILED\n  {exc}")
            cur.close()
            conn.close()
            sys.exit(1)

    print(f"\n{len(pending)} migration(s) applied successfully.")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
