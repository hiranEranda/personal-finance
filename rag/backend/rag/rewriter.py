"""Rewrite a contextual follow-up into a standalone query using recent conversation history."""

from __future__ import annotations

import logging

import httpx

from backend.config import settings

logger = logging.getLogger("backend.rewriter")

_SYSTEM = (
    "You are a query rewriting assistant for a financial document Q&A system. "
    "Given a short conversation history and a follow-up question, rewrite the follow-up "
    "into a fully self-contained question that can be understood without the history. "
    "Output ONLY the rewritten question — no explanation, no preamble, no quotes."
)


def _build_prompt(history: list[dict], question: str) -> str:
    lines = ["Conversation so far:"]
    for msg in history:
        role = "User" if msg["role"] == "user" else "Assistant"
        content = str(msg["content"])[:400]
        lines.append(f"{role}: {content}")
    lines.append(f"\nFollow-up: {question}")
    lines.append("Standalone question:")
    return "\n".join(lines)


def rewrite(question: str, history: list[dict]) -> str:
    """Return a standalone version of question given conversation history.

    Falls back to the original question on any error or empty model response.
    """
    if not history:
        return question

    prompt = f"{_SYSTEM}\n\n{_build_prompt(history, question)}"
    try:
        resp = httpx.post(
            f"{settings.ollama_base_url}/api/generate",
            json={"model": settings.rewriter_model, "prompt": prompt, "stream": False},
            timeout=30.0,
        )
        resp.raise_for_status()
        rewritten = resp.json().get("response", "").strip()
        if rewritten:
            return rewritten
        logger.warning("[REWRITE ] Empty response from model — using original query")
    except Exception as exc:
        logger.warning("[REWRITE ] Failed (%r) — using original query", exc)
    return question
