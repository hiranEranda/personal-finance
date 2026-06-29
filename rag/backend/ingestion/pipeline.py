import asyncio
from pathlib import Path

from backend.config import settings
from backend.ingestion import deduplicator
from backend.ingestion.chunker import chunk_document
from backend.ingestion.doc_classifier import classify
from backend.ingestion.embedder import embed_texts
from backend.ingestion.normalizer.company_financials import normalize
from backend.ingestion.pdf_parser import parse_to_markdown
from backend.rag.vector_store import ensure_collection, upsert_chunks

_PDF_STORAGE = Path(settings.pdf_storage_path)


def _run_ingestion(file_bytes: bytes, doc_id: str, filename: str) -> None:
    try:
        ensure_collection()

        # Save raw PDF (content-addressed)
        file_hash = deduplicator.compute_hash(file_bytes)
        dest_dir = _PDF_STORAGE / file_hash[:2]
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest_path = dest_dir / f"{file_hash}.pdf"
        dest_path.write_bytes(file_bytes)

        # Parse
        raw_text = parse_to_markdown(dest_path)

        # Classify
        classification = classify(raw_text)
        confidence = float(classification.get("confidence", 0))
        if confidence < settings.classifier_confidence_threshold:
            deduplicator.update(
                doc_id,
                status="low_confidence",
                doc_type=classification.get("doc_type"),
                institution=classification.get("institution"),
            )
            return

        # Normalise
        doc = normalize(doc_id, raw_text, classification, file_hash)

        # Chunk
        chunks = chunk_document(doc)

        # Embed
        texts = [c.text for c in chunks]
        embeddings = embed_texts(texts)

        # Write to Qdrant
        count = upsert_chunks(chunks, embeddings)

        deduplicator.update(
            doc_id,
            status="done",
            doc_type=classification.get("doc_type"),
            institution=doc.institution,
            period_start=str(doc.period_start) if doc.period_start else None,
            period_end=str(doc.period_end) if doc.period_end else None,
            currency=doc.currency,
            chunk_count=count,
        )

    except Exception as exc:
        deduplicator.update(doc_id, status="error", error=str(exc))
        raise


async def ingest_async(file_bytes: bytes, filename: str) -> dict:
    """Check for duplicates synchronously, then run heavy work in a thread."""
    file_hash = deduplicator.compute_hash(file_bytes)
    existing = deduplicator.find_by_hash(file_hash)
    if existing:
        return {"status": "duplicate", "doc_id": existing["doc_id"]}

    doc_id = deduplicator.register(file_hash, filename)
    # Run CPU-heavy work off the event loop
    await asyncio.to_thread(_run_ingestion, file_bytes, doc_id, filename)
    result = deduplicator.find_by_id(doc_id) or {}
    return {"status": result.get("status", "unknown"), "doc_id": doc_id, **result}
