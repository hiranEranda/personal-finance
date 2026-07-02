"""Extract abbreviation aliases from document text during ingestion.

Looks for the common financial-report pattern:
    Full Company Name (ABBR)

Returns {alias: expansion} pairs that can be upserted into the aliases table.
"""

from __future__ import annotations

import re

# Match: a capitalised phrase of 8-100 chars followed by (2-6 uppercase letters).
# The phrase must start with a capital letter (rules out mid-sentence fragments).
_PAREN_ABBR = re.compile(r'([A-Z][^()\n]{8,100}?)\s*\(([A-Z]{2,6})\)')

# Abbreviations that appear constantly in financial documents and are not company names.
_BLOCKLIST = {
    # Currencies / units
    'LKR', 'USD', 'EUR', 'GBP', 'JPY', 'RS', 'MN', 'BN', 'MNS', 'BNS',
    # Legal / entity suffixes (these appear inside names, not as standalone aliases)
    'PLC', 'LTD', 'LLC', 'INC', 'PVT',
    # Financial ratios & metrics
    'PAT', 'PBT', 'ROE', 'ROA', 'EPS', 'NAV', 'NPA', 'NPL', 'NIM',
    'ROI', 'EBIT', 'EBITDA', 'FCF', 'WACC', 'PE', 'PB', 'DY',
    # Time periods
    'FY', 'YOY', 'QOQ', 'YTD', 'MTD', 'Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2',
    # Regulatory / exchange bodies
    'AGM', 'EGM', 'CSE', 'SEC', 'CBSL', 'IOSCO', 'IFRS', 'SLAS',
    # Generic document terms
    'MD', 'CEO', 'CFO', 'COO', 'CTO', 'BOD', 'AC',
}


def extract_aliases(raw_text: str) -> dict[str, str]:
    """Return {lowercase_alias: expansion} pairs found in the document text.

    Only patterns of the form 'Proper Name (ABBR)' are matched — generic
    financial abbreviations are filtered out via the blocklist.
    """
    candidates: dict[str, str] = {}
    for match in _PAREN_ABBR.finditer(raw_text):
        full_name = match.group(1).strip().rstrip(',;:.-')
        abbr = match.group(2).strip()

        if abbr in _BLOCKLIST:
            continue
        # Skip if full_name is itself very short (probably not a company name)
        if len(full_name) < 10:
            continue

        alias_key = abbr.lower()
        expansion = f"{full_name} {abbr}"
        # Keep the first occurrence if the same abbreviation appears multiple times
        if alias_key not in candidates:
            candidates[alias_key] = expansion

    return candidates
