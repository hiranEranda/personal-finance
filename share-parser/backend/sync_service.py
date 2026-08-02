"""Processes CSE contract-note PDFs (bought/sold) from the reciepts/ folders
(or freshly-uploaded files) into share_tickers/share_trades/share_sells.

Every line item in a note creates/reuses a ticker and inserts one trade or
sell row. Fees aren't itemised — for a bought note, fees_total = amount -
gross value (mirrors the app's own tradeTotalCost = gross * (1 + feeRate));
for a sold note, commission = gross value - amount, both of which the app
subtracts from proceeds. Idempotency is per-PDF-filename via
processed_share_files, same dedupe strategy as the deposit-parser.
"""

from __future__ import annotations

import logging
from pathlib import Path

from backend.config import settings
from backend.db import shares_repo
from backend.parsers import cal_contract_note as parser

logger = logging.getLogger("backend.sync")

_EMPTY_SUMMARY = {
    "scanned": 0,
    "trades_inserted": 0,
    "sells_inserted": 0,
    "tickers_created": 0,
    "skipped_duplicates": 0,
    "parse_errors": 0,
}


def _process_one(pdf_path: Path, summary: dict) -> None:
    parsed = parser.parse_pdf(pdf_path)
    if parsed is None:
        logger.warning("Could not parse %s", pdf_path.name)
        shares_repo.record_processed_file("unknown", pdf_path.name, "error", "", "Unparseable contract note")
        summary["parse_errors"] += 1
        return

    note_type = parsed["note_type"]
    tx_date = parsed["transaction_date"]
    tickers_seen = []
    notes = f"Auto-synced from {parser.short_label(pdf_path.name)}"

    for item in parsed["items"]:
        ticker = item["ticker"]
        if shares_repo.ensure_ticker(ticker, item["rate"]):
            summary["tickers_created"] += 1
        tickers_seen.append(ticker)

        if note_type == "bought":
            # Content-based dedupe: skip if this exact trade is already in
            # the log, whether from an earlier sync or a manual entry made
            # before this feature existed — filename-level dedupe alone
            # can't catch that.
            if shares_repo.trade_exists(ticker, tx_date, item["qty"], item["rate"]):
                summary["skipped_duplicates"] += 1
                continue
            fees_total = round(item["amount"] - item["gross_value"], 4)
            shares_repo.insert_trade(ticker, tx_date, item["qty"], item["rate"], fees_total, notes)
            summary["trades_inserted"] += 1
        else:
            if shares_repo.sell_exists(ticker, tx_date, item["qty"], item["rate"]):
                summary["skipped_duplicates"] += 1
                continue
            commission = round(item["gross_value"] - item["amount"], 4)
            shares_repo.insert_sell(ticker, tx_date, item["qty"], item["rate"], commission, notes)
            summary["sells_inserted"] += 1

    shares_repo.record_processed_file(note_type, pdf_path.name, "inserted", ",".join(tickers_seen), None)


def run_sync() -> dict:
    summary = dict(_EMPTY_SUMMARY)

    for note_type, folder in (("bought", settings.bought_dir), ("sold", settings.sold_dir)):
        for pdf_path in parser.list_pdfs(folder):
            if shares_repo.is_processed(note_type, pdf_path.name):
                continue
            summary["scanned"] += 1
            _process_one(pdf_path, summary)

    return summary


def ingest_uploads(files: list[tuple[str, bytes]]) -> dict:
    """files: [(filename, content), ...]. Parses each to determine bought vs.
    sold (content is authoritative, not the filename), saves it into the
    matching folder, then processes it exactly like sync would. Skips saving
    if a file with the same name already exists there (already-synced)."""
    summary = dict(_EMPTY_SUMMARY)

    for filename, content in files:
        tmp_path = settings.bought_dir.parent / f"__upload_{filename}"
        tmp_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path.write_bytes(content)

        parsed = parser.parse_pdf(tmp_path)
        if parsed is None:
            tmp_path.unlink(missing_ok=True)
            logger.warning("Could not parse uploaded file %s", filename)
            shares_repo.record_processed_file("unknown", filename, "error", "", "Unparseable contract note")
            summary["scanned"] += 1
            summary["parse_errors"] += 1
            continue

        target_dir = settings.bought_dir if parsed["note_type"] == "bought" else settings.sold_dir
        target_dir.mkdir(parents=True, exist_ok=True)
        dest = target_dir / filename

        # A filename collision (already on disk, or already recorded as
        # processed) means this exact note was synced/uploaded before —
        # treat it as a duplicate rather than saving under a new name, which
        # would re-run _process_one and double-insert the same trades/sells.
        if dest.exists() or shares_repo.is_processed(parsed["note_type"], filename):
            tmp_path.unlink(missing_ok=True)
            summary["scanned"] += 1
            summary["skipped_duplicates"] += 1
            continue

        tmp_path.rename(dest)
        summary["scanned"] += 1
        _process_one(dest, summary)

    return summary
