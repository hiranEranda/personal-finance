"""Ported from data/cal_ut_deposit_confirmations/cal_ut.py — extraction logic
only, no file I/O. PDF_PASSWORD moved to Settings (was hardcoded in source)."""

from __future__ import annotations

import re
from datetime import date
from pathlib import Path

import pdfplumber
from dateutil import parser as date_parser

from backend.config import settings

SOURCE = "cal_ut"


def _standardize_date(date_string: str | None) -> date | None:
    if not date_string:
        return None
    try:
        return date_parser.parse(date_string, fuzzy=True).date()
    except (ValueError, TypeError):
        return None


def parse_pdf(pdf_path: Path) -> dict | None:
    """Returns {fund_name, amount_of_units, nav, total_price, issued_date} or
    None if the PDF couldn't be read/parsed."""
    try:
        with pdfplumber.open(pdf_path, password=settings.cal_ut_pdf_password) as pdf:
            full_text = ""
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    full_text += text.replace("\n", " ") + " "

            if not full_text.strip():
                return None

            units_match = re.search(r"allocated\s+([\d,.]+)\s*\(", full_text)
            nav_match = re.search(r"at\s+LKR\s+([\d,.]+)\s+per\s+Unit", full_text, re.IGNORECASE)
            price_match = re.search(r"amounting\s+to\s+LKR\s+([\d,.]+)\s+in", full_text, re.IGNORECASE)
            fund_match = re.search(r"in\s+the\s+(.*?),\s+of\s+which", full_text)

            date_pattern = (
                r"\b(?:\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|"
                r"Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+20\d{2}|"
                r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|"
                r"Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d{2}|"
                r"\d{4}-\d{2}-\d{2}|\d{2}[-/]\d{2}[-/]20\d{2})\b"
            )
            date_match = re.search(date_pattern, full_text, re.IGNORECASE)

            if not fund_match:
                return None

            def to_float(match_obj):
                return float(match_obj.group(1).replace(",", "")) if match_obj else None

            raw_date = date_match.group(0).strip() if date_match else None

            return {
                "fund_name": fund_match.group(1).strip(),
                "amount_of_units": to_float(units_match),
                "nav": to_float(nav_match),
                "total_price": to_float(price_match),
                "issued_date": _standardize_date(raw_date),
            }
    except Exception:
        return None


def list_pdfs() -> list[Path]:
    return sorted(settings.cal_ut_dir.glob("*.pdf"))
