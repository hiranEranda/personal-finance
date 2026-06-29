"""Answer questions about the knowledge base itself using Qdrant collection stats."""

from __future__ import annotations

from backend.rag.vector_store import get_client
from backend.config import settings


def kb_summary() -> dict:
    """Return counts and distinct document list from Qdrant without touching LLM or reranker."""
    client = get_client()

    count_result = client.count(collection_name=settings.collection_name, exact=True)
    total_chunks = count_result.count

    # Scroll through all points to collect unique (doc_id, institution, period) tuples.
    # Fine for small KBs (dozens of docs); revisit if the KB grows to thousands.
    docs: dict[str, dict] = {}
    offset = None
    while True:
        points, offset = client.scroll(
            collection_name=settings.collection_name,
            limit=256,
            offset=offset,
            with_payload=["doc_id", "institution", "period"],
            with_vectors=False,
        )
        for p in points:
            doc_id = p.payload.get("doc_id", "unknown")
            if doc_id not in docs:
                docs[doc_id] = {
                    "institution": p.payload.get("institution", ""),
                    "period": p.payload.get("period", ""),
                }
        if offset is None:
            break

    return {
        "total_chunks": total_chunks,
        "total_documents": len(docs),
        "documents": list(docs.values()),
    }


def format_kb_answer(question: str) -> str:
    """Return a plain-text answer to a KB metadata question."""
    info = kb_summary()
    n = info["total_documents"]
    docs = info["documents"]

    lines = [f"There are **{n} report{'s' if n != 1 else ''}** in the knowledge base ({info['total_chunks']} chunks indexed)."]
    if docs:
        lines.append("")
        lines.append("Documents available:")
        for d in sorted(docs, key=lambda x: (x["institution"], x["period"])):
            institution = d["institution"] or "Unknown institution"
            period = d["period"] or "Unknown period"
            lines.append(f"  • {institution} — {period}")

    return "\n".join(lines)
