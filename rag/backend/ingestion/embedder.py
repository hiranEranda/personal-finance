from __future__ import annotations

from typing import TYPE_CHECKING

from backend.config import settings

if TYPE_CHECKING:
    from FlagEmbedding import BGEM3FlagModel as _ModelType

_model: "_ModelType | None" = None


def _get_model() -> "_ModelType":
    global _model
    if _model is None:
        from FlagEmbedding import BGEM3FlagModel
        _model = BGEM3FlagModel(settings.embedding_model, use_fp16=True)
    return _model


def embed_texts(texts: list[str]) -> list[dict]:
    """Returns list of {dense, sparse_indices, sparse_values} dicts."""
    model = _get_model()
    output = model.encode(
        texts,
        batch_size=8,
        max_length=512,
        return_dense=True,
        return_sparse=True,
        return_colbert_vecs=False,
    )

    results: list[dict] = []
    for i, dense_vec in enumerate(output["dense_vecs"]):
        lexical: dict = output["lexical_weights"][i]
        results.append({
            "dense": dense_vec.tolist(),
            "sparse_indices": [int(k) for k in lexical],
            "sparse_values": [float(v) for v in lexical.values()],
        })
    return results


def embed_query(text: str) -> dict:
    return embed_texts([text])[0]
