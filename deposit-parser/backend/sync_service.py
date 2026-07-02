"""Scans the CAL and NDBW deposit-confirmation folders, parses new PDFs, and
either inserts a matching transaction or queues the PDF for manual review —
per the interview decisions:
- fund-name matches are remembered permanently via fund_name_aliases
- unmatched names go to a review queue (unlike prices, this is real money —
  silently guessing would risk misattributing a purchase to the wrong fund)
- dedupe is fund+date+amount, not an exact row match, since PDF confirmation
  letters show a rounded 'units' display value that won't bit-match the
  precisely-computed value already in the ledger (e.g. from a CSV migration)
"""

from __future__ import annotations

import logging

from backend.db import deposits_repo
from backend.parsers import cal_ut, ndbw_ut

logger = logging.getLogger("backend.sync")

_SOURCES = [(cal_ut.SOURCE, cal_ut), (ndbw_ut.SOURCE, ndbw_ut)]


def _insert_or_reuse_transaction(fund_id: str, parsed: dict) -> tuple[str, bool]:
    """Returns (transaction_id, was_duplicate)."""
    existing_id = None
    if parsed["issued_date"] is not None and parsed["total_price"] is not None:
        existing_id = deposits_repo.find_existing_transaction(fund_id, parsed["issued_date"], parsed["total_price"])

    if existing_id:
        return existing_id, True

    transaction_id = deposits_repo.insert_transaction(
        fund_id, parsed["issued_date"], parsed["total_price"], parsed["nav"], parsed["amount_of_units"]
    )
    return transaction_id, False


def run_sync() -> dict:
    owned_funds = deposits_repo.get_owned_funds()
    summary = {"scanned": 0, "inserted": 0, "duplicates_skipped": 0, "pending_review": 0, "parse_errors": 0}

    for source, parser_module in _SOURCES:
        alias_map = deposits_repo.get_alias_map(source)

        for pdf_path in parser_module.list_pdfs():
            if deposits_repo.is_processed(source, pdf_path.name):
                continue

            summary["scanned"] += 1
            parsed = parser_module.parse_pdf(pdf_path)

            if parsed is None or not parsed.get("fund_name"):
                logger.warning("Could not parse %s/%s", source, pdf_path.name)
                deposits_repo.record_processed_file(
                    source, pdf_path.name, "", None, None, "error", None, None, None, None
                )
                summary["parse_errors"] += 1
                continue

            fund_id = deposits_repo.resolve_fund_id(parsed["fund_name"], alias_map, owned_funds)

            if fund_id is None:
                deposits_repo.record_processed_file(
                    source,
                    pdf_path.name,
                    parsed["fund_name"],
                    None,
                    None,
                    "pending",
                    parsed["issued_date"],
                    parsed["total_price"],
                    parsed["nav"],
                    parsed["amount_of_units"],
                )
                summary["pending_review"] += 1
                continue

            transaction_id, was_duplicate = _insert_or_reuse_transaction(fund_id, parsed)
            deposits_repo.record_processed_file(
                source,
                pdf_path.name,
                parsed["fund_name"],
                fund_id,
                transaction_id,
                "inserted",
                parsed["issued_date"],
                parsed["total_price"],
                parsed["nav"],
                parsed["amount_of_units"],
            )
            if was_duplicate:
                summary["duplicates_skipped"] += 1
            else:
                summary["inserted"] += 1

    return summary


def list_review_queue() -> list[dict]:
    return deposits_repo.list_pending()


def _resolve_one(pending: dict, fund_id: str) -> dict:
    parsed = {
        "issued_date": pending["issued_date"],
        "total_price": pending["amount"],
        "nav": pending["nav"],
        "amount_of_units": pending["units"],
    }
    transaction_id, was_duplicate = _insert_or_reuse_transaction(fund_id, parsed)
    deposits_repo.resolve_pending(pending["id"], fund_id, transaction_id)
    return {"transaction_id": transaction_id, "was_duplicate": was_duplicate}


def resolve_review_item(review_id: str, fund_id: str) -> dict:
    """Maps the given item to fund_id, remembers the alias, and sweeps any
    other pending items with the same (source, parsed_fund_name) so a single
    mapping clears every file affected by that name, not just one."""
    pending = deposits_repo.get_pending(review_id)
    if pending is None:
        raise ValueError("Unknown or already-resolved review item")

    deposits_repo.add_alias(pending["parsed_fund_name"], pending["source"], fund_id)

    others = deposits_repo.list_pending_with_name(pending["source"], pending["parsed_fund_name"])
    resolved = [_resolve_one(item, fund_id) for item in others]

    primary = next((r for item, r in zip(others, resolved) if item["id"] == review_id), resolved[0])
    return {**primary, "also_resolved": len(resolved) - 1}
