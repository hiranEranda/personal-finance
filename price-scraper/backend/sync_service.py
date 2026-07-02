"""Incremental sync (fast, synchronous) and historical backfill (async, in-memory
job tracking) for owned funds' daily NAVs, per the interview decisions:
- unmatched fund names from the feed are silently skipped, no review queue
  (it's just industry funds we don't hold, not a data-entry mistake)
- backfill job state lives in memory only — cheap to re-trigger if the
  service restarts mid-job, not worth persisting for a rare manual operation
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from datetime import date, timedelta

from backend.db import funds_repo
from backend.scraper import Scraper

logger = logging.getLogger("backend.sync")

_jobs: dict[str, dict] = {}

# "Sync Now" is meant to be a fast, synchronous, day-to-day top-up (see the
# interview notes) — if the gap is bigger than this, it's a one-time catch-up
# that belongs in the async backfill path instead, not a multi-minute blocking
# HTTP request that a browser/proxy could time out on.
MAX_INCREMENTAL_DAYS = 14

# Be polite to utasl.lk — one request per day of history, so don't hammer it.
REQUEST_DELAY_SECONDS = 0.3


class GapTooLargeError(Exception):
    def __init__(self, days: int):
        self.days = days
        super().__init__(
            f"Gap is {days} days, larger than the {MAX_INCREMENTAL_DAYS}-day incremental limit — use backfill instead."
        )


def _scrape_range(start_date: date, end_date: date, owned_funds: list[dict], alias_map: dict, on_progress=None) -> dict:
    if start_date > end_date:
        return {"days_scraped": 0, "nav_rows_upserted": 0, "funds_updated": [], "unmatched_names": []}

    scraper = Scraper()
    nav_rows_upserted = 0
    funds_updated: set[str] = set()
    unmatched_names: set[str] = set()
    days_scraped = 0
    total_days = (end_date - start_date).days + 1

    current = start_date
    while current <= end_date:
        rows = scraper.fetch_day(current)
        for row in rows:
            fund_id = funds_repo.resolve_fund_id(row["fund_name"], alias_map, owned_funds)
            if fund_id is None:
                unmatched_names.add(row["fund_name"])
                continue
            if row["selling_price"] is None:
                continue
            funds_repo.upsert_nav(fund_id, current, row["selling_price"])
            nav_rows_upserted += 1
            funds_updated.add(fund_id)

        days_scraped += 1
        if on_progress:
            on_progress(days_scraped, total_days)
        current += timedelta(days=1)
        if current <= end_date:
            time.sleep(REQUEST_DELAY_SECONDS)

    return {
        "days_scraped": days_scraped,
        "nav_rows_upserted": nav_rows_upserted,
        "funds_updated": sorted(funds_updated),
        "unmatched_names": sorted(unmatched_names),
    }


def run_incremental_sync() -> dict:
    """Scrape the gap since the earliest owned fund's latest saved NAV date,
    through today. Funds with no history yet default to just today."""
    owned_funds = funds_repo.get_owned_funds()
    if not owned_funds:
        return {"days_scraped": 0, "nav_rows_upserted": 0, "funds_updated": [], "unmatched_names": []}

    alias_map = funds_repo.get_alias_map("utasl")

    known_dates = [d for d in (funds_repo.get_latest_nav_date(f["id"]) for f in owned_funds) if d is not None]
    start_date = (min(known_dates) + timedelta(days=1)) if known_dates else date.today()
    end_date = date.today()

    gap_days = (end_date - start_date).days + 1
    if gap_days > MAX_INCREMENTAL_DAYS:
        raise GapTooLargeError(gap_days)

    return _scrape_range(start_date, end_date, owned_funds, alias_map)


def start_backfill(months: int) -> str:
    """Kick off a background thread scraping `months` of history unconditionally
    (re-scraping already-covered days is a harmless no-op upsert). Returns a
    job_id to poll via get_job()."""
    job_id = str(uuid.uuid4())
    _jobs[job_id] = {"status": "running", "days_done": 0, "days_total": None, "result": None, "error": None}

    def _run():
        try:
            owned_funds = funds_repo.get_owned_funds()
            alias_map = funds_repo.get_alias_map("utasl")
            end_date = date.today()
            start_date = end_date - timedelta(days=months * 30)

            def progress(done, total):
                _jobs[job_id]["days_done"] = done
                _jobs[job_id]["days_total"] = total

            result = _scrape_range(start_date, end_date, owned_funds, alias_map, on_progress=progress)
            _jobs[job_id]["status"] = "done"
            _jobs[job_id]["result"] = result
        except Exception as exc:
            logger.exception("Backfill job %s failed", job_id)
            _jobs[job_id]["status"] = "error"
            _jobs[job_id]["error"] = str(exc)

    threading.Thread(target=_run, daemon=True).start()
    return job_id


def get_job(job_id: str) -> dict | None:
    return _jobs.get(job_id)
