import uuid

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    MatchValue,
    PointStruct,
    SparseIndexParams,
    SparseVector,
    SparseVectorParams,
    VectorParams,
)

from backend.config import settings
from backend.ingestion.chunker import Chunk

_client: QdrantClient | None = None


def get_client() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)
    return _client


def ensure_collection() -> None:
    client = get_client()
    existing = {c.name for c in client.get_collections().collections}
    if settings.collection_name not in existing:
        client.create_collection(
            collection_name=settings.collection_name,
            vectors_config={"dense": VectorParams(size=1024, distance=Distance.COSINE)},
            sparse_vectors_config={"sparse": SparseVectorParams(index=SparseIndexParams())},
        )


def upsert_chunks(chunks: list[Chunk], embeddings: list[dict]) -> int:
    client = get_client()
    points = [
        PointStruct(
            id=str(uuid.uuid4()),
            vector={
                "dense": emb["dense"],
                "sparse": SparseVector(
                    indices=emb["sparse_indices"],
                    values=emb["sparse_values"],
                ),
            },
            payload={
                "text": chunk.text,
                "chunk_type": chunk.chunk_type,
                "doc_id": chunk.doc_id,
                "institution": chunk.institution,
                "period": chunk.period,
                "section": chunk.section,
                "table_name": chunk.table_name,
            },
        )
        for chunk, emb in zip(chunks, embeddings)
    ]
    client.upsert(collection_name=settings.collection_name, points=points)
    return len(points)


def delete_by_doc_id(doc_id: str) -> None:
    client = get_client()
    client.delete(
        collection_name=settings.collection_name,
        points_selector=Filter(
            must=[FieldCondition(key="doc_id", match=MatchValue(value=doc_id))]
        ),
    )
