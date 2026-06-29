# RAG System Recommendations

## Rules for maintaining this file

- **Always check statuses before starting work.** Only act on items marked `[ ] TODO` or `[ ] IN PROGRESS`.
- **When fixing something from this file:** update its status to `[x] DONE` and add a short note on what was done and when. Do this before ending the session.
- **Never re-open a `[x] DONE` item** unless a regression is confirmed — create a new item instead.
- **When a new recommendation is identified** during any session, add it here with status `[ ] TODO` before the session ends.
- **Statuses:**
  - `[ ] TODO` — not yet addressed, needs work
  - `[ ] IN PROGRESS` — actively being worked on
  - `[x] DONE` — fixed, no further action needed

---

## Recommendations

---

### REC-001 — Low rerank score cutoff

**Status:** `[ ] IN PROGRESS`

**Problem:**
When a user query has a near-zero best rerank score (e.g. `best=0.006`), the system still forwards the low-quality chunks to the LLM. The LLM then produces a confused or hallucinated answer rather than admitting it couldn't find anything relevant. This was observed with the query `"only list the names"` — a contextual follow-up that had no signal without prior conversation history.

**What's been done (2026-06-29):**
The `best_rerank_score` is now persisted on every `chat_messages` row in PostgreSQL. This makes it possible to query the DB to find which answers were generated from weak retrievals and tune the threshold from real data.

**Remaining work (short term):**
Add a hard score cutoff in `backend/api/chat.py` after reranking. If `best_score < 0.05`, skip the LLM and return:

> "I couldn't find anything in the documents relevant to that question. Try rephrasing, or check that the relevant report has been uploaded."

Threshold of `0.05` is a starting point — tune using observed `best_rerank_score` values in the `chat_messages` table.

**Remaining work (long term):**
Implement REC-002 (chat history + query rewriting). Most near-zero scores from contextual fragments would resolve once the query is rewritten with prior context.

**Files to change:**

- `backend/api/chat.py` — add cutoff check after `[RERANK] Done` log line, before sources are yielded

---

### REC-005 — Narrative chunk size exceeds bge-m3 token limit

**Status:** `[ ] TODO`

**Problem:**
`_MAX_CHUNK_CHARS` in `backend/ingestion/chunker.py` is set to `600 * 4 = 2400 chars ≈ 600 tokens`. `bge-m3`'s maximum input length is 512 tokens. Any narrative chunk longer than that is silently truncated during embedding — no error is raised, the embedding simply represents an incomplete chunk. This means the tail of every large chunk (financial commentary, risk sections, long paragraphs) is invisible to retrieval.

**Observed:** Documents currently ingested have 1176 chunks — some of those narrative chunks are almost certainly over 512 tokens and partially blind.

**Recommended fix:**
Lower `_MAX_CHUNK_CHARS` to `480 * 4 = 1920 chars` (480 tokens, leaving a 32-token buffer for the prefix label that is prepended to every chunk). Also lower `_OVERLAP_CHARS` proportionally, e.g. from 50 tokens to 40 tokens.

After changing the constant, **all documents must be re-ingested** — existing vectors in Qdrant were built from the oversized chunks and won't be corrected automatically.

**Files to change:**
- `backend/ingestion/chunker.py` — lower `_MAX_CHUNK_CHARS` and `_OVERLAP_CHARS`
- Re-ingest all documents via the upload API after the change

---

### REC-004 — Query expansion / abbreviation aliases

**Status:** `[ ] TODO`

**Problem:**
User shorthand that doesn't appear verbatim in document text scores near-zero at rerank even when the intent is clear. Observed: `"dist"` used to mean `"Distilleries Company of Sri Lanka PLC (DCSL)"` — rerank `best=0.028`, LLM generated a poor response after 50s of wasted pipeline work. This is distinct from REC-002 (contextual fragments) — it's a standalone query that simply uses domain-specific shorthand.

**Recommended fix:**
Maintain a small alias map (e.g. in `config.py` or a `aliases.json` sidecar) that expands known shorthand before embedding:

```
"dist" → "Distilleries Company of Sri Lanka PLC DCSL"
"cic"  → "CIC Holdings PLC"
```

Before calling `embed_query`, run the query through the alias expander. The expanded form embeds and retrieves correctly while the original term is still shown in the UI.

This is cheap to implement and would have turned `best=0.028` into a high-confidence retrieval.

**Files to change:**
- `backend/rag/retriever.py` — add alias expansion step before `embed_query`
- `backend/config.py` or new `backend/rag/aliases.json` — store the alias map

---

### REC-002 — Chat history and query rewriting

**Status:** `[ ] IN PROGRESS`

**Problem:**
Each query is treated as stateless. Follow-up questions like `"only list the names"` or `"what about last year?"` have no prior context, so they embed poorly, retrieve irrelevant chunks, and score near-zero at rerank. The router also can't correctly classify contextual fragments — `"only list the names"` was classified `complex` when in context it was a `kb_meta` follow-up.

**What's been done (2026-06-29):**
PostgreSQL tables `chat_sessions` and `chat_messages` are now created and wired in. Every user and assistant turn is persisted. The chat API accepts an optional `session_id` in the request body — if provided, the query is appended to that session; if omitted, a new session is created. New endpoints exist to read back history:

- `GET /api/v1/chat/sessions` — list all sessions
- `GET /api/v1/chat/sessions/{id}` — get session with full message history

**Remaining work:**

1. Pass the last N conversation turns from the frontend with each request (they're now stored in DB — just need to read and attach them).
2. On the backend, before embedding, run a cheap rewrite step: prompt `qwen2.5:3b` to produce a standalone version of the current question using the history. Example: `"only list the names"` + history → `"List the names of the financial reports available in the knowledge base"`.
3. Use the rewritten query for embedding and retrieval; store it in `chat_messages.rewritten_query`; display the original question in the UI.

**Files to change:**

- `backend/api/chat.py` — read last N messages from DB before embedding; call rewrite step; populate `rewritten_query` on the assistant message row
- `backend/rag/retriever.py` — accept rewritten query parameter
- `web/src/app/pages/rag-chat/` (frontend) — pass `session_id` back on every follow-up request (the `session_id` is already returned in the first SSE event of each response)
