# RAG Frontend Integration — Architecture & Developer Guide

## Overview

This document describes how the RAG system is wired into the Angular frontend through the Node/Express server, and explains the two UI pages added for document management and AI-powered chat.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Browser  (Angular 21 — localhost:4200)                      │
│                                                              │
│  /documents  →  RagDocuments page  →  RagService            │
│  /chat       →  RagChat page       →  RagService            │
└────────────────────────┬─────────────────────────────────────┘
                         │ HTTP  (all calls to localhost:3001)
                         │  POST multipart/form-data  (upload)
                         │  GET / DELETE              (docs)
                         │  POST + SSE stream         (chat)
┌────────────────────────▼─────────────────────────────────────┐
│  Node / Express  (localhost:3001)                            │
│                                                              │
│  /api/funds/*       →  handled locally (CSV file store)      │
│  /api/nav-history   →  handled locally                       │
│  /api/rag/*         →  http-proxy-middleware                 │
└────────────────────────┬─────────────────────────────────────┘
                         │ proxy: /api/rag/X  →  /api/v1/X
┌────────────────────────▼─────────────────────────────────────┐
│  FastAPI RAG backend  (localhost:8000)                       │
│                                                              │
│  POST   /api/v1/documents/upload   upload + background ingest│
│  GET    /api/v1/documents          list all documents        │
│  DELETE /api/v1/documents/{id}     delete + remove vectors   │
│  POST   /api/v1/chat/query         SSE streaming Q&A        │
│                                                              │
│  Qdrant  ←── BGE-M3 embeddings                              │
│  Ollama  ←── Qwen2.5-7B (top-5 reranked chunks)            │
└──────────────────────────────────────────────────────────────┘
```

### Repo layout

```
personal-finance/
├── web/      Angular 21 frontend  (ng serve from here)
├── server/   Node/Express API server with RAG proxy
├── rag/      FastAPI RAG backend (ingestion + vector Q&A)
└── docs/     Architecture docs
```

### Why proxy through Node?

- **Single origin** — all frontend calls go to `localhost:3001`, matching existing fund endpoints. No per-environment CORS config needed.
- **Future auth** — JWT checks can be added in one place for both fund and RAG APIs.
- **Production-ready** — change the proxy `target` at deploy time; the Angular build is untouched.

---

## Files Added / Changed

| File | What changed |
|---|---|
| `server/server.js` | Added `http-proxy-middleware`; mounts proxy at `/api/rag` **before** `express.json()` so multipart + SSE pass through raw |
| `web/src/app/shared/services/rag.service.ts` | **New** — upload, list, delete, and SSE streaming chat via Fetch API |
| `web/src/app/pages/rag-documents/` | **New** — drag-and-drop upload page + document list |
| `web/src/app/pages/rag-chat/` | **New** — streaming chat UI with sources and filters |
| `web/src/app/app.routes.ts` | Added `/documents` and `/chat` routes |
| `web/src/app/shared/components/navbar/navbar.html` | Added **Docs** and **AI Chat** nav links |

---

## RagService

`web/src/app/shared/services/rag.service.ts`

```typescript
uploadDocument(file: File): Promise<{ doc_id: string; status: string }>
listDocuments(): Promise<RagDocument[]>
deleteDocument(docId: string): Promise<void>
streamChat(question, institution?, period?): AsyncGenerator<ChatEvent>
```

SSE streaming uses `fetch` + `ReadableStream` because:
- Angular `HttpClient` doesn't support SSE over POST natively.
- `EventSource` only supports GET.
- `fetch` + `ReadableStream` works in all modern browsers with zero extra deps.

---

## Page: `/documents`

| Feature | Detail |
|---|---|
| Drag-and-drop | `dragover/drop` events; `isDragging` signal highlights the zone |
| Click-to-browse | Hidden `<input type="file">` behind a label |
| Duplicate detection | FastAPI returns `409 Conflict`; shown as an error banner |
| Status badges | Processing / Ready / Failed with colour-coded chips |
| Delete | Calls `DELETE /api/rag/documents/:id`; removes vectors from Qdrant |

## Page: `/chat`

| Feature | Detail |
|---|---|
| Streaming tokens | `for await` over `streamChat()` generator; each token appends to the last message |
| Typing indicator | Three bouncing dots while `streaming=true` and content is still empty |
| Sources panel | First SSE event carries `{ sources }`; shown as chips below the answer |
| Filters | Optional institution / period collapse panel scopes the vector search |
| Keyboard | Enter sends; Shift+Enter inserts newline |

---

## Running the full stack

```bash
# 1. Start Qdrant
cd rag && docker compose up -d

# 2. Pull models (first time only)
ollama pull qwen2.5:3b && ollama pull qwen2.5:7b

# 3. Start FastAPI RAG backend
cd rag && uv run uvicorn backend.main:app --reload --port 8000

# 4. Start Node server
cd server && node server.js

# 5. Start Angular
cd web && ng serve
```

Then open:
- `http://localhost:4200/documents` — upload PDFs
- `http://localhost:4200/chat` — ask questions
