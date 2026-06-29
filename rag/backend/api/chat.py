import asyncio
import json
import logging
import time

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.config import settings
from backend.db import chat_repo
from backend.rag.kb_meta import format_kb_answer
from backend.rag.qa_engine import stream_answer
from backend.rag.reranker import rerank
from backend.rag.retriever import retrieve
from backend.rag.router import classify

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])
logger = logging.getLogger("backend.chat")

_DIV = "─" * 60

_RETRIEVAL_K: dict[str, int] = {
    "simple": 5,
    "complex": settings.retrieval_top_k,
}


class QueryRequest(BaseModel):
    question: str
    institution: str | None = None
    period: str | None = None
    # Omit to start a new session; provide to continue an existing one.
    session_id: str | None = None


@router.post("/query")
async def query(req: QueryRequest):
    async def event_stream():
        logger.info(_DIV)
        logger.info(f"[QUERY   ] question='{req.question}'")

        # ── Session ─────────────────────────────────────────────────
        session_id = await asyncio.to_thread(
            chat_repo.get_or_create_session, req.session_id, req.question
        )
        yield f"data: {json.dumps({'session_id': session_id})}\n\n"

        # Save user message
        await asyncio.to_thread(
            chat_repo.create_message,
            session_id, "user", req.question,
            None, None,
            req.institution, req.period,
        )

        # ── Route ───────────────────────────────────────────────────
        intent = classify(req.question)
        logger.info(f"[ROUTER  ] intent={intent!r}")

        # ── KB metadata shortcut ────────────────────────────────────
        if intent == "kb_meta":
            logger.info("[ROUTER  ] Metadata query — answering from Qdrant stats directly")
            answer = await asyncio.to_thread(format_kb_answer, req.question)
            for line in answer.splitlines(keepends=True):
                yield f"data: {json.dumps({'text': line})}\n\n"

            await asyncio.to_thread(
                chat_repo.create_message,
                session_id, "assistant", answer,
            )
            yield "data: [DONE]\n\n"
            logger.info("[ROUTER  ] Done (kb_meta fast path)")
            logger.info(_DIV)
            return

        if req.institution:
            logger.info(f"           institution={req.institution}")
        if req.period:
            logger.info(f"           period={req.period}")

        # ── Retrieve ────────────────────────────────────────────────
        top_k = _RETRIEVAL_K.get(intent, settings.retrieval_top_k)
        logger.info(f"[RETRIEVE] Starting hybrid search — top_k={top_k} (intent={intent})")
        t0 = time.perf_counter()
        candidates = await asyncio.to_thread(retrieve, req.question, req.institution, req.period, top_k)
        logger.info(f"[RETRIEVE] Done — {len(candidates)} candidates  ({time.perf_counter()-t0:.2f}s)")

        if not candidates:
            logger.info("[RETRIEVE] No results found — returning empty response")
            no_result = "No relevant documents found for your query."
            yield f"data: {json.dumps({'text': no_result})}\n\n"
            await asyncio.to_thread(
                chat_repo.create_message,
                session_id, "assistant", no_result,
            )
            yield "data: [DONE]\n\n"
            return

        # ── Rerank ──────────────────────────────────────────────────
        if intent == "simple" and len(candidates) <= 3:
            logger.info(f"[RERANK  ] Skipped — {len(candidates)} candidates, simple intent")
            top = candidates
            best_score = None
        else:
            logger.info(f"[RERANK  ] Starting — {len(candidates)} candidates → top {settings.rerank_top_k}")
            t0 = time.perf_counter()
            top = await asyncio.to_thread(rerank, req.question, candidates)
            best_score = top[0]["rerank_score"] if top else 0.0
            logger.info(
                f"[RERANK  ] Done — {len(top)} selected  "
                f"best={best_score:.3f}  ({time.perf_counter()-t0:.2f}s)"
            )

        sources = [
            {"institution": c["institution"], "period": c["period"], "section": c["section"]}
            for c in top
        ]
        yield f"data: {json.dumps({'sources': sources})}\n\n"

        # ── LLM ─────────────────────────────────────────────────────
        logger.info(f"[LLM     ] Sending to {settings.qa_model!r} — {len(top)} sources in context")
        t0 = time.perf_counter()
        first_token = True
        full_text_parts: list[str] = []
        async for token in stream_answer(req.question, top):
            if first_token:
                logger.info(f"[LLM     ] First token received  ({time.perf_counter()-t0:.2f}s)")
                first_token = False
            full_text_parts.append(token)
            yield f"data: {json.dumps({'text': token})}\n\n"

        logger.info(f"[LLM     ] Streaming complete  ({time.perf_counter()-t0:.2f}s total)")
        logger.info(_DIV)

        # ── Persist assistant message + sources ──────────────────────
        full_text = "".join(full_text_parts)
        assistant_msg_id = await asyncio.to_thread(
            chat_repo.create_message,
            session_id, "assistant", full_text,
            None,          # rewritten_query (REC-002, not yet implemented)
            best_score,
            req.institution,
            req.period,
        )
        await asyncio.to_thread(chat_repo.create_sources, assistant_msg_id, top)

        yield "data: [DONE]\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ---------------------------------------------------------------------------
# Chat history endpoints
# ---------------------------------------------------------------------------

@router.get("/sessions")
def list_sessions():
    return {"sessions": chat_repo.list_sessions()}


@router.get("/sessions/{session_id}")
def get_session(session_id: str):
    session = chat_repo.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    messages = chat_repo.list_messages(session_id)
    return {"session": session, "messages": messages}


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    chat_repo.delete_session(session_id)
    return {"status": "deleted", "session_id": session_id}
