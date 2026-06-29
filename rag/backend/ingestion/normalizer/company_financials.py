import re
from datetime import date
from typing import Optional

from backend.ingestion.normalizer.base import (
    NormalizedDocument,
    NormalizedMetric,
    NormalizedTable,
)

# Patterns for key financial metrics found in annual reports
_METRIC_PATTERNS: list[tuple[str, str]] = [
    (r"(?i)(revenue|turnover)[^\d]{0,20}([\d,\.]+)\s*(B|M|Mn|Bn|billion|million)?", "Revenue"),
    (r"(?i)(net\s+profit|net\s+income|net\s+earnings)[^\d]{0,20}([\d,\.]+)\s*(B|M|Mn|Bn|billion|million)?", "Net Profit"),
    (r"(?i)(gross\s+profit)[^\d]{0,20}([\d,\.]+)\s*(B|M|Mn|Bn|billion|million)?", "Gross Profit"),
    (r"(?i)(EBITDA)[^\d]{0,20}([\d,\.]+)\s*(B|M|Mn|Bn|billion|million)?", "EBITDA"),
    (r"(?i)(EPS|earnings\s+per\s+share)[^\d]{0,20}([\d,\.]+)", "EPS"),
    (r"(?i)(NAV\s+per\s+(?:unit|share))[^\d]{0,20}([\d,\.]+)", "NAV per Unit"),
    (r"(?i)(total\s+assets)[^\d]{0,20}([\d,\.]+)\s*(B|M|Mn|Bn|billion|million)?", "Total Assets"),
    (r"(?i)(total\s+equity)[^\d]{0,20}([\d,\.]+)\s*(B|M|Mn|Bn|billion|million)?", "Total Equity"),
    (r"(?i)(dividend\s+per\s+share)[^\d]{0,20}([\d,\.]+)", "Dividend per Share"),
]


def _parse_markdown_tables(text: str) -> list[NormalizedTable]:
    tables: list[NormalizedTable] = []
    lines = text.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i].strip()
        if not (line.startswith("|") and "|" in line[1:]):
            i += 1
            continue

        headers = [h.strip() for h in line.split("|") if h.strip()]

        # Expect separator row next
        if i + 1 >= len(lines) or not re.match(r"^[\|\s\-:]+$", lines[i + 1].strip()):
            i += 1
            continue

        i += 2
        rows: list[list[str]] = []
        while i < len(lines):
            row_line = lines[i].strip()
            if not (row_line.startswith("|") and "|" in row_line[1:]):
                break
            row = [c.strip() for c in row_line.split("|") if c.strip()]
            rows.append(row)
            i += 1

        if rows and headers:
            tables.append(NormalizedTable(
                name=f"table_{len(tables) + 1}",
                headers=headers,
                rows=rows,
            ))

    return tables


def _extract_metrics(text: str) -> list[NormalizedMetric]:
    metrics: list[NormalizedMetric] = []
    seen: set[str] = set()

    for pattern, label in _METRIC_PATTERNS:
        if label in seen:
            continue
        m = re.search(pattern, text)
        if not m:
            continue
        groups = m.groups()
        value = groups[1] if len(groups) >= 2 else groups[0]
        unit = groups[2] if len(groups) >= 3 else None
        metrics.append(NormalizedMetric(label=label, value=value.strip(), unit=unit))
        seen.add(label)

    return metrics


def _parse_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def normalize(
    doc_id: str,
    raw_text: str,
    classification: dict,
    file_hash: str,
) -> NormalizedDocument:
    return NormalizedDocument(
        doc_id=doc_id,
        doc_type="company_annual_report",
        institution=classification.get("institution") or "Unknown",
        period_start=_parse_date(classification.get("period_start")),
        period_end=_parse_date(classification.get("period_end")),
        currency=classification.get("currency"),
        file_hash=file_hash,
        raw_text=raw_text,
        tables=_parse_markdown_tables(raw_text),
        metrics=_extract_metrics(raw_text),
        metadata={"source": "company_financials"},
    )
