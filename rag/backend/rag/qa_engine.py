import json
from typing import AsyncIterator

import httpx

from backend.config import settings

_SYSTEM_PROMPT = (
    "You are a financial analyst assistant. Answer the user's question using only "
    "the provided source documents. Be precise with numbers — always include the "
    "currency, the period, and the unit (millions, billions, per unit, etc.). "
    "If the answer is not in the documents, say so explicitly. "
    "At the end of every factual claim add a citation: [Source: institution, period]."
    "Do not fabricate figures."
)


def _build_context(candidates: list[dict]) -> str:
    parts = []
    for i, c in enumerate(candidates, 1):
        label = f"Source {i}: {c['institution']} ({c['period']})"
        parts.append(f"[{label}]\n{c['text']}")
    return "\n\n---\n\n".join(parts)


async def stream_answer(question: str, candidates: list[dict]) -> AsyncIterator[str]:
    context = _build_context(candidates)
    prompt = (
        f"{_SYSTEM_PROMPT}\n\n"
        f"Source documents:\n{context}\n\n"
        f"Question: {question}\n\nAnswer:"
    )

    async with httpx.AsyncClient(timeout=180.0) as client:
        async with client.stream(
            "POST",
            f"{settings.ollama_base_url}/api/generate",
            json={"model": settings.qa_model, "prompt": prompt, "stream": True},
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    token = data.get("response", "")
                    if token:
                        yield token
                    if data.get("done"):
                        break
                except json.JSONDecodeError:
                    continue
