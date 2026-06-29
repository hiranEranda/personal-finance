"""
Query router — decides how to handle a question before touching the retrieval pipeline.

Intent categories:
  kb_meta   — question is about the knowledge base itself (count, list docs, etc.)
              → answered directly from Qdrant stats, no retrieval / rerank / LLM needed
  simple    — short factual lookup (single figure, yes/no, definition)
              → retrieve fewer candidates, skip reranking
  complex   — comparison, trend analysis, multi-document synthesis
              → full pipeline with reranking
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Keyword patterns for metadata queries (about the KB, not document content)
# ---------------------------------------------------------------------------
_META_PATTERNS = [
    r"\bhow\s+many\s+(reports?|documents?|files?|pdfs?|records?)\b",
    r"\b(list|show|what)\s+(all\s+)?(the\s+)?(reports?|documents?|files?|pdfs?)\b",
    r"\bwhat\s+(reports?|documents?|data)\s+(do\s+)?(we|you)\s+have\b",
    r"\bwhat('s|\s+is)\s+in\s+(the\s+)?(knowledge\s+base|db|database|vector\s+(store|db))\b",
    r"\bwhat\s+(institutions?|companies|funds?)\s+(are|do)\s+(available|we\s+have|you\s+have)\b",
    r"\bwhich\s+(institutions?|companies|funds?|reports?|documents?|periods?|years?|months?)\s+are\s+(available|loaded|ingested|in\s+(the\s+)?kb|in\s+(the\s+)?knowledge)\b",
    r"\bwhich\s+(institutions?|companies|funds?)\s+(do\s+)?(we|you)\s+have\b",
    r"\bdo\s+we\s+have\s+(any\s+)?(data|reports?|documents?)\s+(for|on|about)\b",
]

_META_RE = re.compile("|".join(_META_PATTERNS), re.IGNORECASE)

# ---------------------------------------------------------------------------
# Keyword patterns for simple single-fact queries
# ---------------------------------------------------------------------------
_SIMPLE_PATTERNS = [
    r"\bwhat\s+(is|was|were)\s+the\b",          # "what is the NAV", "what was the return"
    r"\bhow\s+much\b",
    r"\bwhat\s+(is|are)\s+the\s+\w+\s+(fee|rate|price|value|return|yield|nav)\b",
    r"\bwhen\s+(was|did|is)\b",
    r"\bwho\s+(is|are|manages?)\b",
]

_SIMPLE_RE = re.compile("|".join(_SIMPLE_PATTERNS), re.IGNORECASE)


def classify(question: str) -> str:
    """Return 'kb_meta', 'simple', or 'complex'."""
    q = question.strip()
    if _META_RE.search(q):
        return "kb_meta"
    if _SIMPLE_RE.search(q):
        return "simple"
    return "complex"
