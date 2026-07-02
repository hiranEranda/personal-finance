import re
from dataclasses import dataclass, field

from backend.ingestion.normalizer.base import NormalizedDocument

_CHARS_PER_TOKEN = 4
_MIN_CHUNK_CHARS = 300 * _CHARS_PER_TOKEN   # ~1200 chars
_MAX_CHUNK_CHARS = 480 * _CHARS_PER_TOKEN   # ~1920 chars — fits bge-m3's 512-token limit with room for prefix
_OVERLAP_CHARS = 40 * _CHARS_PER_TOKEN      # ~160 chars
_TABLE_ROWS_PER_CHUNK = 8


@dataclass
class Chunk:
    text: str
    chunk_type: str          # "narrative" | "table" | "metric"
    doc_id: str
    institution: str
    period: str
    section: str = ""
    table_name: str = ""
    metadata: dict = field(default_factory=dict)


def _period_label(doc: NormalizedDocument) -> str:
    if doc.period_end:
        year = str(doc.period_end.year)
        if doc.period_start and doc.period_start.year != doc.period_end.year:
            return f"{doc.period_start.year}–{doc.period_end.year}"
        return year
    return ""


def _narrative_prefix(doc: NormalizedDocument, section: str) -> str:
    return f"[company_financials | {doc.institution} | {_period_label(doc)} | {section}]"


def _table_prefix(doc: NormalizedDocument, table_name: str) -> str:
    currency = doc.currency or ""
    return f"[{table_name} | {doc.institution} | {_period_label(doc)} | {currency}]"


def _chunk_narrative(doc: NormalizedDocument) -> list[Chunk]:
    chunks: list[Chunk] = []
    period = _period_label(doc)
    current_section = "General"
    current_text = ""

    def flush(section: str) -> None:
        nonlocal current_text
        stripped = current_text.strip()
        if not stripped:
            return
        prefix = _narrative_prefix(doc, section)
        chunks.append(Chunk(
            text=f"{prefix}\n{stripped}",
            chunk_type="narrative",
            doc_id=doc.doc_id,
            institution=doc.institution,
            period=period,
            section=section,
        ))
        current_text = ""

    for line in doc.raw_text.split("\n"):
        stripped = line.strip()
        if not stripped:
            continue

        heading = re.match(r"^(#{1,4})\s+(.+)$", stripped)
        if heading:
            flush(current_section)
            current_section = heading.group(2)[:80]
            continue

        # Skip markdown table lines — handled separately
        if stripped.startswith("|"):
            continue

        candidate = (current_text + " " + stripped).strip()

        if len(candidate) > _MAX_CHUNK_CHARS and current_text.strip():
            flush(current_section)
            # Carry overlap into next chunk
            current_text = current_text[-_OVERLAP_CHARS:].strip() + " " + stripped
        else:
            current_text = candidate

    flush(current_section)
    return chunks


def _chunk_tables(doc: NormalizedDocument) -> list[Chunk]:
    chunks: list[Chunk] = []
    period = _period_label(doc)

    for table in doc.tables:
        header_row = " | ".join(table.headers)
        rows = table.rows

        for i in range(0, max(len(rows), 1), _TABLE_ROWS_PER_CHUNK):
            batch = rows[i : i + _TABLE_ROWS_PER_CHUNK]
            if not batch:
                continue
            rows_text = "\n".join(" | ".join(row) for row in batch)
            prefix = _table_prefix(doc, table.name)
            chunks.append(Chunk(
                text=f"{prefix}\n{header_row}\n{rows_text}",
                chunk_type="table",
                doc_id=doc.doc_id,
                institution=doc.institution,
                period=period,
                table_name=table.name,
            ))

    return chunks


def _chunk_metrics(doc: NormalizedDocument) -> list[Chunk]:
    chunks: list[Chunk] = []
    period = _period_label(doc)

    for metric in doc.metrics:
        prefix = f"[{metric.label} | {doc.institution} | {period}]"
        value_str = metric.value
        if metric.unit:
            value_str += f" {metric.unit}"

        parts = [f"{prefix}", f"{metric.label}: {value_str}"]
        if metric.prior_value:
            parts.append(f"Prior period: {metric.prior_value}")
        if metric.change_pct:
            parts.append(f"Change: {metric.change_pct}")

        chunks.append(Chunk(
            text=" ".join(parts),
            chunk_type="metric",
            doc_id=doc.doc_id,
            institution=doc.institution,
            period=period,
        ))

    return chunks


def chunk_document(doc: NormalizedDocument) -> list[Chunk]:
    return _chunk_narrative(doc) + _chunk_tables(doc) + _chunk_metrics(doc)
