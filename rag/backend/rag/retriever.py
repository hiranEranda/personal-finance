import logging
import re
import time

from qdrant_client.models import (
    FieldCondition,
    Filter,
    Fusion,
    FusionQuery,
    MatchValue,
    Prefetch,
    SparseVector,
)

from backend.config import settings
from backend.ingestion.embedder import embed_query
from backend.rag.vector_store import get_client

logger = logging.getLogger("backend.retriever")

# ---------------------------------------------------------------------------
# REC-004: alias expansion — loaded from DB with a 60-second TTL cache
# ---------------------------------------------------------------------------

_alias_cache: dict[str, str] = {}
_alias_cache_ts: float = 0.0
_ALIAS_TTL = 60.0


def _load_aliases() -> dict[str, str]:
    try:
        from backend.db import aliases_repo
        return {row["alias"]: row["expansion"] for row in aliases_repo.list_active()}
    except Exception as exc:
        logger.warning("[ALIASES ] Could not load from DB: %r", exc)
        return {}


def _get_aliases() -> dict[str, str]:
    global _alias_cache, _alias_cache_ts
    if time.monotonic() - _alias_cache_ts > _ALIAS_TTL:
        _alias_cache = _load_aliases()
        _alias_cache_ts = time.monotonic()
    return _alias_cache


def expand_query(query: str) -> str:
    """Append full-form expansions for any domain shorthand found in the query.

    Matches are whole-word and case-insensitive. The original query text is
    preserved — expansions are appended, never substituted.
    """
    aliases = _get_aliases()
    if not aliases:
        return query
    q_lower = query.lower()
    expansions = [
        expansion
        for alias, expansion in aliases.items()
        if re.search(rf"\b{re.escape(alias)}\b", q_lower)
    ]
    if expansions:
        return query + " " + " ".join(expansions)
    return query


# ---------------------------------------------------------------------------
# Retrieval
# ---------------------------------------------------------------------------

def retrieve(
    query: str,
    institution: str | None = None,
    period: str | None = None,
    top_k: int | None = None,
) -> list[dict]:
    if top_k is None:
        top_k = settings.retrieval_top_k

    expanded = expand_query(query)
    if expanded != query:
        logger.info("[ALIASES ] Expanded query: '%s'", expanded)

    client = get_client()
    query_emb = embed_query(expanded)

    must_filters = []
    if institution:
        must_filters.append(FieldCondition(key="institution", match=MatchValue(value=institution)))
    if period:
        must_filters.append(FieldCondition(key="period", match=MatchValue(value=period)))

    filter_param = Filter(must=must_filters) if must_filters else None

    results = client.query_points(
        collection_name=settings.collection_name,
        prefetch=[
            Prefetch(query=query_emb["dense"], using="dense", limit=top_k),
            Prefetch(
                query=SparseVector(
                    indices=query_emb["sparse_indices"],
                    values=query_emb["sparse_values"],
                ),
                using="sparse",
                limit=top_k,
            ),
        ],
        query=FusionQuery(fusion=Fusion.RRF),
        limit=top_k,
        with_payload=True,
        query_filter=filter_param,
    )

    return [
        {
            "text": p.payload["text"],
            "score": p.score,
            "doc_id": p.payload.get("doc_id", ""),
            "institution": p.payload.get("institution", ""),
            "period": p.payload.get("period", ""),
            "section": p.payload.get("section", ""),
            "chunk_type": p.payload.get("chunk_type", ""),
        }
        for p in results.points
    ]
