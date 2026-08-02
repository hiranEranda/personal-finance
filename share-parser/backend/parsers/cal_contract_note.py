"""Parses Capital Alliance Securities CSE contract notes (BOUGHT/SOLD PDFs).

Layout (see reciepts/bought, reciepts/sold for real samples): a header block
with "BOUGHTNote"/"SOLDNote" and "Transaction Date YYYY/MM/DD", followed by a
line-item table, one row per line:

    Contract No  Qty  Security  Rate  Gross Value  <fee columns...>  Amount in RS.

A note can hold multiple line items (multiple tickers bought/sold on the same
day). Row parsing is token-based rather than a fixed-width regex because the
number of fee columns isn't guaranteed across brokers/layouts — only the
first three tokens (contract no, qty, ticker) and the last token (amount) are
load-bearing; everything between is fees we don't need individually since
fees/commission is derived as amount vs. gross value.
"""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path

import pdfplumber
from dateutil import parser as date_parser

_TICKER_RE = re.compile(r"^[A-Z]{2,8}\.[A-Z0-9]{2,8}$")
_DATE_RE = re.compile(r"Transaction Date\s+(\d{4}/\d{2}/\d{2})")


def _to_float(token: str) -> float:
    return float(token.replace(",", ""))


def _parse_row(line: str) -> dict | None:
    tokens = line.split()
    if len(tokens) < 6:
        return None
    if not tokens[0].isdigit():
        return None
    if not re.match(r"^[\d,.]+$", tokens[1]):
        return None
    if not _TICKER_RE.match(tokens[2]):
        return None
    try:
        return {
            "contract_no": tokens[0],
            "qty": _to_float(tokens[1]),
            "ticker": tokens[2],
            "rate": _to_float(tokens[3]),
            "gross_value": _to_float(tokens[4]),
            "amount": _to_float(tokens[-1]),
        }
    except ValueError:
        return None


def parse_pdf(pdf_path: Path) -> dict | None:
    """Returns {note_type, transaction_date, items: [...]}, or None if the
    PDF couldn't be read or doesn't look like a recognised contract note."""
    try:
        with pdfplumber.open(pdf_path) as pdf:
            full_text = "\n".join(page.extract_text() or "" for page in pdf.pages)
    except Exception:
        return None

    if not full_text.strip():
        return None

    if "BOUGHTNote" in full_text or "Bought by order" in full_text:
        note_type = "bought"
    elif "SOLDNote" in full_text or "Sold by order" in full_text:
        note_type = "sold"
    else:
        return None

    date_match = _DATE_RE.search(full_text)
    transaction_date: date | None = None
    if date_match:
        try:
            transaction_date = date_parser.parse(date_match.group(1)).date()
        except (ValueError, TypeError):
            transaction_date = None
    if transaction_date is None:
        return None

    items = [row for line in full_text.splitlines() if (row := _parse_row(line)) is not None]
    if not items:
        return None

    return {"note_type": note_type, "transaction_date": transaction_date, "items": items}


def list_pdfs(folder: Path) -> list[Path]:
    if not folder.exists():
        return []
    return sorted(folder.glob("*.pdf"))
