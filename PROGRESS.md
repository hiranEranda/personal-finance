# FinanceOS — Development Progress

> Last updated: 2026-06-29
> Reference spec: `finance-app-docs.md`

---

## Quick Status

| Phase | Description | Status |
|---|---|---|
| Phase 1 | Foundation — infrastructure + PDF ingestion | ✅ Done |
| Phase 2 | Expense intelligence | ❌ Not started |
| Phase 3 | RAG pipeline | ✅ **Core complete + DB-backed** |
| Phase 4 | Investment ledger | 🟡 Partial (frontend only) |
| Phase 5 | Dashboard & polish | 🟡 Partial |

---

## What's Built

### RAG Backend (Python / FastAPI) — `personal-finance/rag/`

All core RAG pipeline components are implemented and working:

| Component | File | Status | Notes |
|---|---|---|---|
| FastAPI app | `backend/main.py` | ✅ | CORS for ports 3000, 5173, 4200 |
| Config | `backend/config.py` | ✅ | pydantic-settings, .env support |
| PDF parser | `backend/ingestion/pdf_parser.py` | ✅ | MarkItDown-based |
| Document classifier | `backend/ingestion/doc_classifier.py` | ✅ | Ollama qwen2.5:3b, returns JSON |
| Normalizer base | `backend/ingestion/normalizer/base.py` | ✅ | NormalizedDocument Pydantic model |
| Company financials normalizer | `backend/ingestion/normalizer/company_financials.py` | ✅ | Regex metric extraction + markdown table parser |
| Chunker | `backend/ingestion/chunker.py` | ✅ | Narrative + table + metric chunks with prefixes |
| Embedder | `backend/ingestion/embedder.py` | ✅ | FlagEmbedding BGE-M3 (dense + sparse) |
| Deduplicator | `backend/ingestion/deduplicator.py` | ✅ | SHA-256, JSON file store |
| Ingestion pipeline | `backend/ingestion/pipeline.py` | ✅ | Background task via asyncio.to_thread |
| Vector store | `backend/rag/vector_store.py` | ✅ | Qdrant, hybrid dense+sparse collection |
| Retriever | `backend/rag/retriever.py` | ✅ | RRF fusion, metadata filtering |
| Reranker | `backend/rag/reranker.py` | ✅ | FlagEmbedding bge-reranker-v2-m3 |
| QA engine | `backend/rag/qa_engine.py` | ✅ | Streaming via Ollama SSE |
| Documents API | `backend/api/documents.py` | ✅ | Upload, list, get, delete |
| Chat API | `backend/api/chat.py` | ✅ | SSE streaming with sources metadata |

### Node.js BFF — `personal-finance/server/`

| Component | Status | Notes |
|---|---|---|
| Express server (port 3001) | ✅ | Serves fund data APIs |
| RAG proxy `/api/rag/*` → FastAPI `:8000` | ✅ | http-proxy-middleware, rewrites path to `/api/v1/` |
| Fund CRUD API (CSV-based) | ✅ | Reads/writes `database/active_funds/*.csv` |
| NAV history API | ✅ | Reads `database/nav_history.json` |

### Angular Frontend — `personal-finance/web/`

| Page / Component | Route | Status | Notes |
|---|---|---|---|
| Home (dashboard) | `/home` | ✅ | Portfolio overview |
| Manage Funds | `/manage-funds` | ✅ | Add/edit/delete investment positions |
| Funds list | `/funds` | ✅ | All holdings |
| Fund detail | `/fund/:id` | ✅ | Per-holding chart + lot detail |
| Compare funds | `/compare` | ✅ | Side-by-side performance |
| Analytics | `/analytics` | ✅ | Advanced analytics view |
| Forecast | `/forecast` | ✅ | Growth projection |
| **RAG Documents** | `/documents` | ✅ | PDF upload, ingestion status table, delete |
| **RAG Chat** | `/chat` | ✅ | Streaming Q&A, source citation display, institution/period filters |
| Login | `/login` | ✅ | |
| Navbar | shared | ✅ | |

### Data / Models

| Item | Location | Status |
|---|---|---|
| Fund transactions | `server/database/active_funds/*.csv` | ✅ |
| NAV history | `server/database/nav_history.json` | ✅ |
| Document registry | `rag/storage/documents.json` | ✅ |
| PDF archive | `rag/storage/pdfs/` | ✅ |

---

## Model Status

### Ollama models (LLM inference)

| Model | Purpose | Status |
|---|---|---|
| qwen2.5:3b | Document classifier | ✅ Downloaded (1.9 GB) |
| qwen2.5:7b | Financial Q&A | ✅ Downloaded (4.7 GB) |
| phi4-mini | Expense categoriser | ❌ Not downloaded |
| smollm3:3b | Structured extraction | ❌ Not downloaded |
| qwen2.5:14b | Report summarisation | ❌ Not downloaded |
| deepseek-r1:7b | Complex reasoning | ❌ Not downloaded |

### HuggingFace models (embeddings / reranking)

| Model | Purpose | Status |
|---|---|---|
| BAAI/bge-m3 | Embeddings (dense + sparse) | ✅ Downloaded (`~/.cache/huggingface/hub/models--BAAI--bge-m3`) |
| BAAI/bge-reranker-v2-m3 | Reranking | ⚠️ **NOT pre-downloaded** — FlagEmbedding will auto-download on first use (~1.1 GB) |

> **Note on reranker:** The `bge-reranker-v2-m3` model has NOT been manually downloaded to the HuggingFace cache yet. The `reranker.py` lazy-loads it via `FlagReranker()` which will trigger an automatic HuggingFace download on first `/chat/query` call. This will work but will add latency on first use. To pre-download: run the FastAPI server and make one test query, or run `python -c "from FlagEmbedding import FlagReranker; FlagReranker('BAAI/bge-reranker-v2-m3', use_fp16=True)"` inside the venv.

---

## Architecture Deviations from Spec

The implemented stack differs from `finance-app-docs.md` in a few areas:

| Spec says | Actual implementation | Impact |
|---|---|---|
| Next.js 15 frontend | Angular 21 (PrimeNG + Tailwind) | None — different framework, same features |
| PostgreSQL + SQLAlchemy + Alembic | JSON files (documents.json) + CSV files | No relational DB yet; limits expense/investment features |
| Celery + Redis for async tasks | FastAPI `BackgroundTasks` | Simpler, no task queue; fine for single-user |
| mlx-embeddings (Apple Silicon) | FlagEmbedding (PyTorch) | Works; mlx would be faster on M-series GPU |
| Multiple Qdrant collections per doc type | Single `company_financials` collection | Only company reports supported in RAG currently |

---

## What's NOT Built Yet

### Phase 2 — Expense Intelligence (not started)
- [ ] Bank statement parser (pdfplumber)
- [ ] Expense categorisation (Phi-4-mini via Ollama)
- [ ] Merchant rule cache + learning loop
- [ ] Category correction UI
- [ ] Monthly expense summary + trend endpoints
- [ ] Anomaly detection + alerts
- [ ] PostgreSQL schema for transactions + category_rules

### Phase 3 — RAG gaps
- [ ] bge-reranker-v2-m3 pre-downloaded (auto-downloads on first use)
- [ ] Unit trust report normalizer (`normalizer/unit_trust_report.py`)
- [ ] Bank statement normalizer (`normalizer/bank_statement.py`)
- [ ] Brokerage statement normalizer (`normalizer/brokerage_statement.py`)
- [ ] Separate Qdrant collections for each doc type (currently only `company_financials`)

### Phase 4 — Investment Ledger (partial)
- [ ] Proper investment lot/sale CRUD with PostgreSQL
- [ ] XIRR calculation (scipy)
- [ ] FX rate tracking at lot level
- [ ] NAV history import from unit trust performance reports
- [ ] Current value vs purchase price overlay chart

### Phase 5 — Dashboard & Polish
- [ ] Net worth timeseries (bank balances + portfolio)
- [ ] Portfolio allocation donut chart (automated from holdings)
- [ ] Brokerage statement parser
- [ ] Recurring transaction detection
- [ ] Monthly auto-generated expense summary
- [ ] Benchmark comparison chart

---

## Known Issues / Technical Debt

1. **Document storage is file-based** — `documents.json` has no locking; concurrent uploads could race. Acceptable for single-user but note the risk.
2. **Reranker not pre-downloaded** — First RAG query will stall while model downloads (~1.1 GB). Pre-download before demo.
3. **Path rewrite bug risk in RAG proxy** — `server.js` uses `pathRewrite: { "^/": "/api/v1/" }` which rewrites all leading `/` chars. Verify this only applies to the `/api/rag` mount path (it does, due to scoping, but worth confirming with a live test).
4. ~~**RAG status field mismatch** — Backend uses `status: "done"` but frontend `RagDocument` type expects `"ready"`. Documents will show as unknown status in UI after ingestion.~~ **Fixed 2026-06-29** — updated `RagDocument` type and `statusBadge()` to handle all backend values: `done` (→ "Ready"), `error` (→ "Failed"), `low_confidence` (→ "Low Confidence").
5. ~~**No PostgreSQL**~~ **Fixed 2026-06-29** — PostgreSQL now backing the RAG system (`documents`, `chat_sessions`, `chat_messages`, `chat_sources`). Run `python database/migrate.py` to apply schema. Expense/investment DB tables deferred to Phase 2/4.

---

## How to Run (current state)

```bash
# 1. Start Qdrant (Docker)
docker run -p 6333:6333 qdrant/qdrant

# 2. Start Ollama (must have qwen2.5:3b and qwen2.5:7b)
ollama serve

# 3. Start FastAPI RAG backend
cd personal-finance/rag
source .venv/bin/activate
uvicorn backend.main:app --reload --port 8000

# 4. Start Node.js BFF
cd personal-finance/server
node server.js          # runs on :3001

# 5. Start Angular frontend
cd personal-finance/web
npm start               # runs on :4200
```

Open `http://localhost:4200`

---

## Next Priorities

1. **Pre-download reranker** — run one warm-up query to cache `bge-reranker-v2-m3`
2. **Fix status field mismatch** — backend `"done"` vs frontend `"ready"` in `RagDocument`
3. **Unit trust normalizer** — add `normalizer/unit_trust_report.py` to enable fund Q&A
4. **PostgreSQL RAG schema** — ✅ done 2026-06-29. Expense/investment tables are Phase 2/4.
5. **Bank statement parser** — Phase 2 foundation
