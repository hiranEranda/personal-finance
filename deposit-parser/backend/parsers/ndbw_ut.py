"""Ported from data/ndbw_ut_deposit_confirmations/ndbw_ut.py — extraction
logic only, no file I/O."""

from __future__ import annotations

import re
from datetime import date, datetime
from pathlib import Path

import pdfplumber

from backend.config import settings

SOURCE = "ndbw_ut"


def _parse_transaction_date(date_string: str | None) -> date | None:
    """Parses '27-Jan-2026' style dates from the document."""
    if not date_string:
        return None
    try:
        return datetime.strptime(date_string.strip(), "%d-%b-%Y").date()
    except ValueError:
        return None


def parse_pdf(pdf_path: Path) -> dict | None:
    try:
        with pdfplumber.open(pdf_path) as pdf:
            full_text = ""
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    full_text += text + "\n"

            if not full_text.strip():
                return None

            fund_match = re.search(r"Fund Name:\s*([^\n]+)", full_text, re.IGNORECASE)
            units_match = re.search(r"No of Units Alloted:\s*([\d,.]+)", full_text, re.IGNORECASE)
            nav_match = re.search(r"Unit Selling Price Rs\.?\s*([\d,.]+)", full_text, re.IGNORECASE)
            price_match = re.search(r"Transaction Value Rs\.?\s*([\d,.]+)", full_text, re.IGNORECASE)
            date_match = re.search(r"Transaction Date:\s*([\d]{1,2}-[A-Za-z]{3}-\d{4})", full_text, re.IGNORECASE)

            if not fund_match:
                return None

            def to_float(match_obj):
                return float(match_obj.group(1).replace(",", "")) if match_obj else None

            raw_date = date_match.group(1).strip() if date_match else None

            return {
                "fund_name": fund_match.group(1).strip(),
                "amount_of_units": to_float(units_match),
                "nav": to_float(nav_match),
                "total_price": to_float(price_match),
                "issued_date": _parse_transaction_date(raw_date),
            }
    except Exception:
        return None


def list_pdfs() -> list[Path]:
    return sorted(settings.ndbw_ut_dir.glob("*.pdf"))
