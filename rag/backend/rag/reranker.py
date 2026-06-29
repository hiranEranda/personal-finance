from __future__ import annotations

import logging
import types
from typing import TYPE_CHECKING

from backend.config import settings

if TYPE_CHECKING:
    from FlagEmbedding import FlagReranker as _RerankerType

_reranker: "_RerankerType | None" = None
logger = logging.getLogger("backend.reranker")

_BATCH = 5  # candidates per progress tick


def _patch_tokenizer(tokenizer) -> None:
    """Add prepare_for_model removed in transformers 5.x that FlagEmbedding still calls.

    XLMRoberta format: <s> query </s> passage </s>
    Uses cls_token_id / sep_token_id which exist in all transformers versions.
    """
    if hasattr(tokenizer, "prepare_for_model"):
        return

    def prepare_for_model(
        self, ids, pair_ids=None, truncation=None, max_length=None,
        padding=False, add_special_tokens=True, **kwargs
    ):
        pair = list(pair_ids) if pair_ids else []
        if add_special_tokens:
            n_special = 3  # CLS + SEP + SEP
            if max_length and pair:
                cap = max(0, max_length - len(ids) - n_special)
                pair = pair[:cap]
            seq = [self.cls_token_id] + list(ids) + [self.sep_token_id] + pair + [self.sep_token_id]
        else:
            seq = list(ids) + pair
        return {"input_ids": seq, "attention_mask": [1] * len(seq)}

    tokenizer.prepare_for_model = types.MethodType(prepare_for_model, tokenizer)


def _get_reranker() -> "_RerankerType":
    global _reranker
    if _reranker is None:
        logger.info("[RERANK  ] Loading model %r ...", settings.reranker_model)
        from FlagEmbedding import FlagReranker
        _reranker = FlagReranker(settings.reranker_model, use_fp16=True)
        _patch_tokenizer(_reranker.tokenizer)
        logger.info("[RERANK  ] Model ready")
    return _reranker


def _bar(done: int, total: int, width: int = 20) -> str:
    filled = int(width * done / total)
    return f"[{'█' * filled}{'░' * (width - filled)}] {done}/{total} ({100 * done // total}%)"


def rerank(query: str, candidates: list[dict], top_k: int | None = None) -> list[dict]:
    if top_k is None:
        top_k = settings.rerank_top_k
    if not candidates:
        return []

    reranker = _get_reranker()
    pairs = [[query, c["text"]] for c in candidates]
    total = len(pairs)
    all_scores: list[float] = []

    for i in range(0, total, _BATCH):
        batch = pairs[i : i + _BATCH]
        scores = reranker.compute_score(batch, normalize=True)
        if isinstance(scores, float):
            scores = [scores]
        all_scores.extend(scores)
        done = min(i + _BATCH, total)
        logger.info("[RERANK  ] %s", _bar(done, total))

    for candidate, score in zip(candidates, all_scores):
        candidate["rerank_score"] = float(score)

    return sorted(candidates, key=lambda x: x["rerank_score"], reverse=True)[:top_k]
