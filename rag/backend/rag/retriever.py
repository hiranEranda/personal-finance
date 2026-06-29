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


def retrieve(
    query: str,
    institution: str | None = None,
    period: str | None = None,
    top_k: int | None = None,
) -> list[dict]:
    if top_k is None:
        top_k = settings.retrieval_top_k

    client = get_client()
    query_emb = embed_query(query)

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
