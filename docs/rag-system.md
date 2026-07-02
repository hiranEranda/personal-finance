# RAG System — Company Financial Document Intelligence

## What it does

The RAG (Retrieval-Augmented Generation) system lets you upload company annual reports as PDFs and then ask plain-language questions about them. It finds the most relevant passages using semantic search and feeds them to a local LLM to generate a cited answer — all running on your machine with no cloud APIs.

Chat sessions are persisted in PostgreSQL so conversations survive server restarts.

**Example flow:**

> Upload "Dialog Axiata Annual Report 2024.pdf" → Ask "What was the revenue growth in FY2024?" → Get an answer with source citations → Come back tomorrow and continue the same conversation.

---

## Architecture

```
Frontend (Angular)
      │  HTTP (multipart / JSON / SSE)
      ▼
Node/Express server  :3001
      │  proxy  /api/rag → /api/v1
      ▼
FastAPI RAG backend  :8000
      │
      ├─ Ingestion pipeline
      │     PDF → MarkItDown → Classifier → Normalizer → Chunker → Embedder → Qdrant
      │
      ├─ Query pipeline
      │     Query → Embed → Qdrant hybrid search → Reranker → Qwen2.5-7B → SSE stream
      │
      └─ Storage
            PostgreSQL  — documents registry, chat sessions, chat history
            Qdrant      — vector embeddings (dense + sparse)
            Filesystem  — raw PDF archive
```

---

## Database

PostgreSQL is used for all structured state. The schema lives in `personal-finance/database/`.

### Tables

| Table | Purpose |
|---|---|
| `documents` | Registry of every uploaded PDF — replaces the old `documents.json` file |
| `chat_sessions` | One row per conversation; holds a title and timestamps |
| `chat_messages` | Every user and assistant turn, linked to a session |
| `chat_sources` | Source chunks cited in each assistant answer |

### First-time setup

```bash
# 1. Create the database (only needed once)
createdb financeos

# 2. Create the schema (safe to re-run)
cd personal-finance
python database/init_db.py
```

The script reads `DATABASE_URL` from `rag/.env`. The default value in `.env.example` uses the local `postgres` superuser with no password — change it if your PostgreSQL requires credentials:

```
DATABASE_URL=postgresql://postgres@localhost:5432/financeos
```

### Changing the schema later

There's no migration history to manage — `database/schema.sql` always reflects
the complete current schema (everything is `CREATE TABLE IF NOT EXISTS`). Edit
it in place and re-run `python database/init_db.py` against your dev database.

---

## Ingestion pipeline (what happens when you upload a PDF)

### 1. Deduplication

The PDF is hashed with SHA-256 before any parsing. If the same file was already uploaded the request is rejected with `409 Conflict`. The hash is checked against the `documents` table.

### 2. Parsing

[MarkItDown](https://github.com/microsoft/markitdown) converts the PDF to clean Markdown. It handles text, tables, and headings, producing output ideal for chunking.

### 3. Classification

Qwen2.5-3B (via Ollama) reads the first ~3,000 characters and returns:

```json
{
    "doc_type": "company_annual_report",
    "institution": "Dialog Axiata",
    "period_start": "2024-01-01",
    "period_end": "2024-12-31",
    "currency": "LKR",
    "confidence": 0.97
}
```

Documents with confidence < 0.75 are flagged as `low_confidence` in the `documents` table and not ingested into Qdrant.

### 4. Normalisation

A typed `NormalizedDocument` schema is produced containing:

- `raw_text` — full cleaned text
- `tables` — all markdown tables parsed into header + rows
- `metrics` — key financial figures extracted by regex (Revenue, Net Profit, EPS, etc.)

### 5. Chunking

Three chunk types are produced from every document:

| Type             | Size                       | Strategy                            | Example prefix                                                        |
| ---------------- | -------------------------- | ----------------------------------- | --------------------------------------------------------------------- |
| Narrative        | 300–600 tokens, 50 overlap | Paragraph-aware, never mid-sentence | `[company_financials \| Dialog Axiata \| 2024 \| Revenue Discussion]` |
| Table rows       | Header + 8 rows            | Header repeated in every chunk      | `[table_3 \| Dialog Axiata \| 2024 \| LKR]`                           |
| Metric snapshots | ~50 tokens                 | One metric per chunk                | `[Revenue \| Dialog Axiata \| 2024] Revenue: 123.4 Bn`                |

The context prefix is embedded **into the chunk text** (not only in Qdrant metadata) so the embedding captures entity context and retrieval works even without pre-filtering.

### 6. Embedding

[BGE-M3](https://huggingface.co/BAAI/bge-m3) (via the `FlagEmbedding` Python library) embeds each chunk simultaneously into:

- **Dense vector** (1024-dim) — semantic similarity
- **Sparse vector** (SPLADE lexical weights) — keyword matching

Both vector types are stored in Qdrant per chunk.

### 7. Vector store

Qdrant holds one collection: `company_financials`. Each point has the two vector spaces plus a payload:

```json
{
    "text": "...",
    "chunk_type": "narrative",
    "doc_id": "uuid",
    "institution": "Dialog Axiata",
    "period": "2024",
    "section": "Revenue Discussion"
}
```

The `doc_id` in Qdrant payloads is the same UUID as `documents.id` in PostgreSQL — this is how `chat_sources` links a cited chunk back to the source document.

---

## Query pipeline (what happens when you ask a question)

### 0. Session management

Every query is associated with a **chat session**. If the frontend sends a `session_id`, the query is appended to that session. If no `session_id` is provided, a new session is created and its ID is returned in the first SSE event so the frontend can use it for follow-up messages.

### 1. Intent routing

Before any retrieval, the query is classified into one of three intents:

| Intent | Description | Pipeline |
| --- | --- | --- |
| `kb_meta` | Question is about the knowledge base itself ("how many reports do we have?") | Answered directly from Qdrant stats — no embedding, retrieval, reranking, or LLM call |
| `simple` | Short single-fact lookup ("what was the NAV?", "how much…") | Retrieves a smaller candidate set (top 5), skips reranking if ≤ 3 candidates |
| `complex` | Comparison, trend analysis, multi-document synthesis | Full pipeline with default retrieval size and mandatory reranking |

### 2. Embed the query

BGE-M3 embeds the user's question into both a dense and sparse vector.

### 3. Hybrid retrieval

Qdrant runs dense cosine similarity (semantic) and sparse dot product (lexical) searches simultaneously. Results are fused with **RRF (Reciprocal Rank Fusion)**.

| Intent | `top_k` |
| --- | --- |
| `simple` | 5 |
| `complex` | 10 (configurable via `RETRIEVAL_TOP_K` in `.env`) |

### 4. Reranking

A cross-encoder reranker scores each query–chunk pair. The top 5 become the context window.

| Model | Size | Speed (CPU) | When to use |
| --- | --- | --- | --- |
| `BAAI/bge-reranker-base` | ~270 MB | Fast (~5–10s for 20 pairs) | **Default** — development, low latency |
| `BAAI/bge-reranker-v2-m3` | ~570 MB | Slow (~60–200s on CPU) | Better accuracy when latency is acceptable |

Set via `RERANKER_MODEL` in `.env`.

### 5. Answer generation

Qwen2.5-7B-Instruct (via Ollama) receives the top-5 chunks and the user's question. The answer is streamed token-by-token via **Server-Sent Events (SSE)**.

### 6. Persistence

After streaming completes, the assistant message and all source citations are saved to PostgreSQL. The `best_rerank_score` is stored alongside the message to enable future score-cutoff tuning (see RECOMMENDATIONS.md REC-001).

---

## API routes (via Node proxy)

All frontend calls go to the Node server (`localhost:3001`) which proxies `/api/rag/*` to the FastAPI backend (`localhost:8000/api/v1/*`).

### Document endpoints

| Method   | Path                        | Description                                       |
| -------- | --------------------------- | ------------------------------------------------- |
| `POST`   | `/api/rag/documents/upload` | Upload a PDF (multipart/form-data, field: `file`) |
| `GET`    | `/api/rag/documents`        | List all ingested documents                       |
| `GET`    | `/api/rag/documents/:id`    | Get document status and metadata                  |
| `DELETE` | `/api/rag/documents/:id`    | Delete document and its Qdrant vectors            |

### Chat endpoints

| Method   | Path                              | Description                                 |
| -------- | --------------------------------- | ------------------------------------------- |
| `POST`   | `/api/rag/chat/query`             | Ask a question — returns SSE stream         |
| `GET`    | `/api/rag/chat/sessions`          | List all chat sessions                      |
| `GET`    | `/api/rag/chat/sessions/:id`      | Get a session with its full message history |
| `DELETE` | `/api/rag/chat/sessions/:id`      | Delete a session and all its messages       |

**Chat request body:**

```json
{
    "question": "What was the net profit in FY2024?",
    "institution": "Dialog Axiata",
    "period": "2024",
    "session_id": "3f7a1c2d-..."
}
```

`session_id` is optional. Omit it to start a new conversation; include it to continue an existing one.

**SSE event format:**

```
data: {"session_id": "3f7a1c2d-..."}

data: {"sources": [{"institution": "...", "period": "...", "section": "..."}]}

data: {"text": "The net"}
data: {"text": " profit"}
data: {"text": " was..."}

data: [DONE]
```

The `session_id` event is always the first event in the stream — the frontend should capture it and pass it back on follow-up queries to maintain conversation context.

**Get session with history:**

```json
{
    "session": { "id": "...", "title": "What was the net profit...", "created_at": "..." },
    "messages": [
        {
            "id": "...",
            "role": "user",
            "content": "What was the net profit in FY2024?",
            "created_at": "...",
            "sources": []
        },
        {
            "id": "...",
            "role": "assistant",
            "content": "The net profit for FY2024 was...",
            "best_rerank_score": 0.823,
            "created_at": "...",
            "sources": [
                {
                    "institution": "Dialog Axiata",
                    "period": "2024",
                    "section": "Financial Highlights",
                    "chunk_text": "...",
                    "rerank_score": 0.823,
                    "position": 1
                }
            ]
        }
    ]
}
```

---

## Models

| Role                | Model               | Runs via               | Auto-downloaded               |
| ------------------- | ------------------- | ---------------------- | ----------------------------- |
| Document classifier | Qwen2.5-3B-Instruct | Ollama                 | No — `ollama pull qwen2.5:3b` |
| Q&A generation      | Qwen2.5-7B-Instruct | Ollama                 | No — `ollama pull qwen2.5:7b` |
| Embedding           | BGE-M3              | FlagEmbedding (Python) | Yes — on first run            |
| Reranking           | bge-reranker-base _(default)_ / bge-reranker-v2-m3 | FlagEmbedding (Python) | Yes — on first run |

---

## Running locally

See the root `README.md` for the full setup (Docker Compose for
Postgres/Qdrant/server/web, `rag/` run natively). Quick reference for the
RAG-specific pieces once the stack is up:

```bash
python database/init_db.py   # create the schema (idempotent)
cd rag && uv sync && uv run uvicorn backend.main:app --reload --port 8000
```

Open `http://localhost:4200`

First upload will be slow (~2 min) while BGE-M3 and the reranker download. Subsequent uploads are fast.

> **Startup note:** the backend pre-warms both models on launch. You'll see `[STARTUP] Models ready — server accepting requests` in the log when it's done.

---

## File locations

```
personal-finance/
├── database/                  ← schema + init script
│   ├── schema.sql              ← complete schema (documents, chat_*, funds, etc.)
│   └── init_db.py              ← runs schema.sql against DATABASE_URL
├── docs/
│   └── rag-system.md          ← this file
├── rag/                       ← FastAPI backend
│   ├── backend/
│   │   ├── db/                ← PostgreSQL layer
│   │   │   ├── connection.py  ← psycopg2 connection pool
│   │   │   ├── documents_repo.py  ← documents table CRUD
│   │   │   └── chat_repo.py   ← chat tables CRUD
│   │   ├── ingestion/         ← PDF → chunks → embeddings
│   │   └── rag/               ← retrieval, reranking, Q&A
│   └── storage/pdfs/          ← raw PDF archive (SHA-256 addressed)
├── server/
│   └── server.js              ← Node proxy: /api/rag → FastAPI
└── web/src/app/pages/
    ├── rag-documents/         ← Upload & manage documents
    └── rag-chat/              ← Chat Q&A interface
```

