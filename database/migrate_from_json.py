#!/usr/bin/env python3
"""
One-time migration: import existing documents from rag/storage/documents.json
into the PostgreSQL documents table.

Run this AFTER applying SQL migrations (migrate.py) if you had documents
ingested before the database integration was added.

Usage:
    cd personal-finance
    python database/migrate_from_json.py

Safe to re-run — ON CONFLICT DO NOTHING skips rows already in the DB.
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
        print("  cd personal-finance/rag && uv run python ../database/migrate_from_json.py")
        sys.exit(1)

    json_path = repo_root / "rag" / "storage" / "documents.json"
    if not json_path.exists():
        print(f"No documents.json found at {json_path} — nothing to migrate.")
        return

    raw = json.loads(json_path.read_text())
    docs = raw.get("documents", [])
    if not docs:
        print("documents.json is empty — nothing to migrate.")
        return

    conn = psycopg2.connect(database_url)
    cur = conn.cursor()

    inserted = 0
    skipped = 0

    for d in docs:
        doc_id = d.get("doc_id")
        file_hash = d.get("file_hash")
        filename = d.get("filename", "unknown.pdf")
        status = d.get("status", "done")
        chunk_count = d.get("chunk_count") or 0
        ingested_at = d.get("ingested_at")
        institution = d.get("institution")
        period_start = d.get("period_start")
        period_end = d.get("period_end")
        currency = d.get("currency")

        if not doc_id or not file_hash:
            print(f"  SKIP  missing doc_id or file_hash: {d}")
            skipped += 1
            continue

        # Skip records that were marked deleted or never finished
        if status == "deleted":
            skipped += 1
            continue

        cur.execute(
            """
            INSERT INTO documents
                (id, file_hash, filename, status, chunk_count, ingested_at,
                 institution, period_start, period_end, currency)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                doc_id, file_hash, filename, status, chunk_count, ingested_at,
                institution, period_start, period_end, currency,
            ),
        )
        if cur.rowcount == 1:
            inserted += 1
            print(f"  OK    {filename} ({doc_id[:8]}…)")
        else:
            skipped += 1
            print(f"  SKIP  already exists: {filename} ({doc_id[:8]}…)")

    conn.commit()
    cur.close()
    conn.close()

    print(f"\nDone — {inserted} inserted, {skipped} skipped.")
    print("The original documents.json has not been deleted.")


if __name__ == "__main__":
    main()
