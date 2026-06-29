from datetime import date
from typing import Optional
from pydantic import BaseModel


class NormalizedTable(BaseModel):
    name: str
    headers: list[str]
    rows: list[list[str]]


class NormalizedMetric(BaseModel):
    label: str
    value: str
    unit: Optional[str] = None
    period: Optional[str] = None
    prior_value: Optional[str] = None
    change_pct: Optional[str] = None


class NormalizedDocument(BaseModel):
    doc_id: str
    doc_type: str
    institution: str
    period_start: Optional[date] = None
    period_end: Optional[date] = None
    currency: Optional[str] = None
    file_hash: str
    raw_text: str
    tables: list[NormalizedTable] = []
    metrics: list[NormalizedMetric] = []
    metadata: dict = {}
