# FinanceOS — Open Source Personal Finance Intelligence Platform

> A fully local, privacy-first finance application combining PDF ingestion, RAG-powered document Q&A, automated expense categorization, investment tracking, and performance visualisation. All models run on-device — no data leaves your machine.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Functional Requirements](#2-functional-requirements)
3. [Architecture Overview](#3-architecture-overview)
4. [Project Structure](#4-project-structure)
5. [Technology Stack](#5-technology-stack)
6. [Document Ingestion Pipeline](#6-document-ingestion-pipeline)
7. [RAG System](#7-rag-system)
8. [Expense Intelligence](#8-expense-intelligence)
9. [Investment Ledger](#9-investment-ledger)
10. [Visualisation & Dashboard](#10-visualisation--dashboard)
11. [Open Source Model Selection](#11-open-source-model-selection)
12. [Hardware Profile & Memory Budget](#12-hardware-profile--memory-budget)
13. [Database Schema](#13-database-schema)
14. [API Design](#14-api-design)
15. [Chunking Strategy](#15-chunking-strategy)
16. [Execution Phases](#16-execution-phases)
17. [Additional Feature Backlog](#17-additional-feature-backlog)

---

## 1. Project Overview

FinanceOS is a fully open source, locally-run personal finance platform designed to make sense of the full range of financial documents a private investor accumulates — bank statements, brokerage statements, company annual reports, and unit trust performance reports. It combines a document intelligence layer (PDF parsing + RAG) with structured data features (investment ledger, expense tracking) and a rich visualisation frontend.

**Core design principles:**

- Everything runs locally — no cloud APIs, no data leaving the machine
- All AI models are open source (Apache 2.0 or MIT licensed where possible)
- SLMs handle fast, structured tasks; larger models are reserved for reasoning-heavy jobs
- The system learns from user corrections over time (expense categories, merchant rules)
- Built for a single-user deployment on Apple Silicon (M3 Pro 18GB baseline)

---

## 2. Functional Requirements

### 2.1 Document Management

- Upload PDFs via drag-and-drop or file picker
- Automatically detect document type: bank statement, brokerage statement, company financial report, unit trust performance report
- Detect institution name and date range from document content
- Deduplicate uploads by content hash (SHA-256) — re-uploading the same statement is a no-op
- Store original PDFs in a local file archive with checksums
- Display upload history with document type, institution, period, and processing status

### 2.2 Expense Tracking

- Parse bank and credit card statements into individual transactions
- Automatically categorize each transaction into a predefined category (groceries, utilities, dining, transport, investment, salary, etc.)
- Store a confidence score alongside each auto-categorization
- Allow the user to manually correct any category
- Learn from corrections: persist merchant → category rules so the same merchant is never re-categorized by LLM on future uploads
- Show monthly expense breakdown by category
- Show spending trends over time per category
- Flag unusual transactions (amount significantly above merchant average)
- Detect recurring transactions and subscriptions automatically

### 2.3 Financial Document Q&A

- Ask plain-language questions about any uploaded document or set of documents
- Receive answers with cited source paragraphs (document name, page number, section)
- Scope queries to a specific document, a specific company, or all documents
- Support questions across document types: "Compare Dialog and Mobitel's revenue growth over the last two years"
- Stream answers token-by-token for responsiveness

### 2.4 Investment Ledger

- Record investment purchases: instrument name, type (equity, unit trust, bond, ETF), buy date, units/quantity, purchase price, currency, broker
- Record sales: sell date, units, sell price
- Track cost basis per lot (FIFO, LIFO, and specific lot identification)
- Calculate current value using latest available price data
- Calculate unrealised gain/loss per holding and total portfolio
- Calculate XIRR (extended internal rate of return) per holding and overall portfolio
- Support multiple currencies with FX rate tracking at purchase date
- Import unit trust NAV history from parsed performance reports

### 2.5 Performance Visualisation

- Portfolio net worth over time (line chart)
- Per-holding performance vs purchase price (bar or line chart)
- Unit trust NAV history with purchase price overlay
- Portfolio allocation breakdown (pie/donut chart)
- Expense category breakdown by month (stacked bar chart)
- Spending trend per category over time (line chart)
- Benchmark comparison: overlay a user-selected index against portfolio performance
- All charts support time range controls (1M, 3M, 6M, 1Y, 3Y, All)

### 2.6 Alerts & Insights

- Unusual spending detected (transaction > 2σ above merchant average)
- New recurring charge detected
- Subscription amount changed
- Portfolio allocation drifted beyond user-defined threshold
- Unit trust performance report newly available and ingested
- Monthly expense summary auto-generated on first day of each month

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js)                        │
│  Dashboard │ Expense Manager │ Investment Ledger │ Doc Q&A Chat  │
└────────────────────────────┬────────────────────────────────────┘
                             │ REST / WebSocket
┌────────────────────────────▼────────────────────────────────────┐
│                       FastAPI Backend                            │
│                                                                  │
│  ┌─────────────────┐   ┌──────────────┐   ┌──────────────────┐  │
│  │ Ingestion layer │   │  RAG engine  │   │  Feature APIs    │  │
│  │                 │   │              │   │                  │  │
│  │ PDF parser      │   │ BGE-M3       │   │ Expense service  │  │
│  │ Doc classifier  │   │ bge-reranker │   │ Investment svc   │  │
│  │ Normalizer      │   │ Qdrant       │   │ Alert service    │  │
│  │ Chunker         │   │ Qwen2.5-7B   │   │ Insight service  │  │
│  │ Embedder        │   │              │   │                  │  │
│  └────────┬────────┘   └──────┬───────┘   └────────┬─────────┘  │
└───────────┼────────────────────┼───────────────────┼────────────┘
            │                   │                   │
┌───────────▼───────────────────▼───────────────────▼────────────┐
│                         Storage Layer                            │
│   PostgreSQL (transactions, investments, NAV)                    │
│   Qdrant vector DB (document embeddings)                         │
│   Local file system (raw PDFs, SHA-256 index)                   │
└─────────────────────────────────────────────────────────────────┘
```

### Layer responsibilities

**Ingestion layer** — receives raw PDFs, routes them to the correct parser, normalises output into a unified schema, chunks the content using a content-type-aware strategy, embeds chunks, and writes to both the vector DB and PostgreSQL.

**RAG engine** — handles all semantic retrieval. Embeds queries with BGE-M3, retrieves top-20 candidates from Qdrant using hybrid dense+sparse search, reranks to top-5 with bge-reranker-v2-m3, then passes context to Qwen2.5-7B for answer generation with source citations.

**Feature APIs** — domain-specific business logic: expense categorisation (Phi-4-mini), merchant rule lookup, investment XIRR calculations, NAV history queries, alert generation.

**Storage layer** — PostgreSQL for all structured relational data. Qdrant for vector embeddings with metadata filtering. Local filesystem for raw PDF archive.

---

## 4. Project Structure

```
financeos/
├── backend/
│   ├── main.py                        # FastAPI app entry point
│   ├── config.py                      # Model names, paths, settings
│   ├── ingestion/
│   │   ├── pdf_parser.py              # pdfplumber + MarkItDown routing
│   │   ├── doc_classifier.py          # SLM-based document type detection
│   │   ├── normalizer/
│   │   │   ├── base.py                # NormalizedDocument schema (Pydantic)
│   │   │   ├── bank_statement.py
│   │   │   ├── brokerage_statement.py
│   │   │   ├── company_financials.py
│   │   │   └── unit_trust_report.py
│   │   ├── chunker.py                 # Content-type-aware chunker
│   │   ├── embedder.py                # BGE-M3 via mlx-embeddings
│   │   └── deduplicator.py            # SHA-256 content hashing
│   ├── rag/
│   │   ├── vector_store.py            # Qdrant client wrapper
│   │   ├── retriever.py               # Hybrid dense+sparse search
│   │   ├── reranker.py                # bge-reranker-v2-m3
│   │   └── qa_engine.py              # LLM answer generation + citation
│   ├── services/
│   │   ├── expense_service.py         # Categorization + merchant rules
│   │   ├── investment_service.py      # Ledger CRUD + XIRR calculation
│   │   ├── nav_service.py             # NAV history queries + import
│   │   ├── alert_service.py           # Anomaly detection + notifications
│   │   └── model_router.py            # Ollama model lifecycle manager
│   ├── api/
│   │   ├── documents.py               # Upload, list, delete endpoints
│   │   ├── expenses.py                # Transaction + category endpoints
│   │   ├── investments.py             # Ledger + performance endpoints
│   │   ├── chat.py                    # Streaming Q&A endpoint
│   │   └── dashboard.py               # Aggregated summary endpoints
│   └── models/
│       ├── document.py                # SQLAlchemy ORM models
│       ├── transaction.py
│       ├── investment.py
│       ├── nav_history.py
│       └── category_rule.py
│
├── frontend/
│   ├── app/                           # Next.js App Router
│   │   ├── dashboard/page.tsx
│   │   ├── expenses/page.tsx
│   │   ├── investments/page.tsx
│   │   ├── documents/page.tsx
│   │   └── chat/page.tsx
│   ├── components/
│   │   ├── charts/
│   │   │   ├── NetWorthChart.tsx
│   │   │   ├── NavHistoryChart.tsx
│   │   │   ├── ExpenseCategoryChart.tsx
│   │   │   ├── SpendingTrendChart.tsx
│   │   │   └── PortfolioAllocationChart.tsx
│   │   ├── expenses/
│   │   │   ├── TransactionTable.tsx
│   │   │   └── CategoryBadge.tsx
│   │   ├── investments/
│   │   │   ├── HoldingCard.tsx
│   │   │   └── LotTable.tsx
│   │   ├── chat/
│   │   │   ├── ChatWindow.tsx
│   │   │   └── SourceCitation.tsx
│   │   └── ui/                        # Shared: Button, Modal, etc.
│   ├── lib/
│   │   ├── api.ts                     # Typed API client
│   │   └── formatters.ts              # Currency, date, percentage utils
│   └── hooks/
│       ├── useTransactions.ts
│       ├── useInvestments.ts
│       └── useChat.ts
│
├── vector_db/
│   └── qdrant_config.yaml             # Collections, index settings
│
├── storage/
│   └── pdfs/                          # Raw PDF archive (gitignored)
│       └── {sha256[:2]}/{sha256}.pdf  # Content-addressed storage
│
├── scripts/
│   ├── setup_db.py                    # Create tables + seed categories
│   ├── pull_models.sh                 # ollama pull for all required models
│   └── backfill_embeddings.py         # Re-embed after chunking strategy changes
│
├── tests/
│   ├── test_parser.py
│   ├── test_normalizer.py
│   ├── test_chunker.py
│   └── test_rag.py
│
├── docker-compose.yml                 # Qdrant + PostgreSQL
├── pyproject.toml
├── .env.example
└── README.md
```

---

## 5. Technology Stack

### Backend

| Component | Choice | Rationale |
|---|---|---|
| Web framework | FastAPI | Async, fast, OpenAPI docs out of the box |
| PDF parsing (tables) | pdfplumber | Best-in-class table extraction for statements |
| PDF parsing (narrative) | MarkItDown (Microsoft) | Clean Markdown output ideal for RAG ingestion |
| ORM | SQLAlchemy 2.0 + Alembic | Migrations, async support |
| Database | PostgreSQL 16 | Relational data; TimescaleDB extension for NAV history |
| Vector database | Qdrant | Hybrid dense+sparse search, metadata filtering, local-first |
| LLM inference | Ollama | Model lifecycle management, Metal acceleration on macOS |
| Embedding inference | mlx-embeddings | Apple Silicon optimised, uses Metal GPU directly |
| RAG orchestration | LlamaIndex | Document pipelines, retrieval abstractions |
| Task queue | Celery + Redis | Async PDF ingestion jobs |
| Testing | pytest + httpx | |

### Frontend

| Component | Choice | Rationale |
|---|---|---|
| Framework | Next.js 15 (App Router) | SSR, TypeScript, file-based routing |
| Charting | Recharts | Composable, React-native, well-documented |
| UI components | shadcn/ui + Tailwind CSS | Unstyled base, full control |
| Data fetching | TanStack Query | Caching, background refetch, streaming support |
| State management | Zustand | Lightweight, no boilerplate |

### Infrastructure (local)

| Component | Choice |
|---|---|
| Container runtime | Docker Desktop |
| PostgreSQL | Docker (postgres:16-alpine) |
| Qdrant | Docker (qdrant/qdrant) |
| Redis | Docker (redis:7-alpine) |
| Python environment | uv (fast, modern pip replacement) |
| Node environment | pnpm |

---

## 6. Document Ingestion Pipeline

### 6.1 Parser routing

Not all financial PDFs are the same. The parser is selected based on document type detected at classification:

```
Document type             → Primary parser      → Output format
──────────────────────────────────────────────────────────────────
Bank statement            → pdfplumber          → Structured JSON rows
Credit card statement     → pdfplumber          → Structured JSON rows
Brokerage statement       → pdfplumber          → Structured JSON (holdings + trades)
Company annual report     → MarkItDown          → Markdown (sections + tables)
Unit trust perf. report   → MarkItDown          → Markdown + structured NAV rows
```

MarkItDown handles narrative-heavy documents well. pdfplumber is used wherever precise table extraction into typed fields is required.

### 6.2 Document classifier

A lightweight Qwen2.5-3B call classifies the first 2 pages of every uploaded PDF before the full parse runs. Output is a JSON object:

```json
{
  "doc_type": "bank_statement",
  "institution": "Commercial Bank of Ceylon",
  "account_number": "****4821",
  "period_start": "2024-11-01",
  "period_end": "2024-11-30",
  "currency": "LKR",
  "confidence": 0.97
}
```

If `confidence < 0.75`, the document is flagged for manual review rather than proceeding to parse.

### 6.3 Normalizer

Each document type has its own normalizer class that implements a common `normalize(raw_output) -> NormalizedDocument` interface. The `NormalizedDocument` Pydantic model is the contract between ingestion and everything downstream:

```python
class NormalizedDocument(BaseModel):
    doc_id: str                          # UUID
    doc_type: DocType
    institution: str
    period_start: date
    period_end: date
    currency: str
    file_hash: str                       # SHA-256, used for dedup
    raw_text: str                        # Full cleaned text for RAG
    structured_data: dict                # Type-specific extracted data
    tables: list[NormalizedTable]        # Extracted tables with headers
    metrics: list[NormalizedMetric]      # Key metrics (NAV, EPS, ratios)
    metadata: dict                       # Pass-through for vector DB
```

### 6.4 Deduplication

On every upload, the PDF is hashed with SHA-256 before any parsing begins. The hash is checked against the `documents` table. If a match is found, the upload is rejected with a `409 Conflict` response indicating the original upload date. This prevents duplicate transactions from appearing in expense totals.

---

## 7. RAG System

### 7.1 Chunking strategy

Three distinct chunk types are produced from every document, each with its own strategy:

**Narrative chunks** (from MarkItDown output)
- Size: 300–600 tokens
- Overlap: 50 tokens
- Split boundary: paragraph breaks (`\n\n`), never mid-sentence
- Prefix: `[{doc_type} | {institution} | {period} | {section_title}]`

**Table-row chunks** (from pdfplumber or MarkItDown table blocks)
- Always include the header row at the top of every chunk
- Group 5–10 semantically related rows per chunk (e.g. all revenue line items together)
- Never split a single row across chunks
- Prefix: `[{table_name} | {institution} | {period} | {currency}]`

**Metric snapshot chunks** (key figures extracted as named metrics)
- One metric per chunk
- Always include: label, value, unit, period, prior period value
- Example: `[NAV | Ceybank Unit Trust | Dec 2024] NAV per unit: LKR 18.42 (Dec 2023: LKR 15.90, change: +15.8%)`

### 7.2 Embedding

All chunks are embedded with **BGE-M3** running locally via mlx-embeddings. BGE-M3 produces three vector types simultaneously:

- Dense vector (1024-dim) — semantic similarity
- Sparse vector (SPLADE-style) — lexical term matching
- Multi-vector (ColBERT-style) — token-level late interaction

All three are stored in Qdrant per chunk, enabling hybrid retrieval.

### 7.3 Vector store

Qdrant is configured with a single collection (`company_financials`) covering all ingested document types. Each chunk is stored with metadata that enables runtime filtering without separate collections:

```
collection: company_financials

Payload fields per chunk:
  doc_id, institution, period, section, chunk_type, currency, text
```

Queries can be scoped at retrieval time using Qdrant's metadata pre-filter on `institution` and/or `period`.

### 7.4 Retrieval pipeline

```
User query
   │
   ▼
Intent router — classify as kb_meta / simple / complex
   │
   ├─ kb_meta → answer from Qdrant stats directly (no retrieval / LLM)
   │
   ▼
Embed query (BGE-M3 dense + sparse)
   │
   ▼
Qdrant hybrid search with RRF fusion
   (top 5 for simple queries, top 10 for complex)
   (metadata pre-filter: institution, period if specified)
   │
   ▼
Cross-encoder reranker — rerank to top 5
   (skipped for simple queries with ≤ 3 candidates)
   │
   ▼
Build context window with source citations
   │
   ▼
Qwen2.5-7B-Instruct — generate answer (streamed)
   │
   ▼
Response with inline citations [Source: institution, period]
```

### 7.5 System prompt for financial Q&A

```
You are a financial analyst assistant. Answer the user's question using only
the provided source documents. Be precise with numbers — always include the
currency, the period, and the unit (millions, billions, per unit, etc.).
If the answer is not in the documents, say so explicitly.
At the end of every factual claim add a citation: [Source: institution, period].
Do not fabricate figures.
```

---

## 8. Expense Intelligence

### 8.1 Category taxonomy

```
Income
  └── Salary, Freelance, Investment income, Other income

Housing
  └── Rent/mortgage, Utilities, Home maintenance, Internet

Transport
  └── Fuel, Vehicle maintenance, Public transport, Ride-hailing, Parking

Food & Dining
  └── Groceries, Restaurants, Cafes, Food delivery

Healthcare
  └── Medical, Pharmacy, Insurance

Education
  └── Tuition, Books, Online courses

Entertainment
  └── Streaming, Events, Hobbies

Shopping
  └── Clothing, Electronics, Home goods

Financial
  └── Loan repayment, Credit card payment, Bank charges, Fees

Investments
  └── Unit trust purchase, Equity purchase, Fixed deposit

Transfers
  └── Internal transfer (excluded from expense totals)

Other
  └── Uncategorized
```

### 8.2 Categorization flow

```python
def categorize_transaction(txn: Transaction) -> CategoryResult:
    # 1. Check merchant rule cache first (fast, free, learned from corrections)
    rule = db.query(CategoryRule).filter_by(merchant=txn.merchant_normalized).first()
    if rule and rule.confidence > 0.90:
        return CategoryResult(category=rule.category, source="rule", confidence=1.0)

    # 2. Fall back to Phi-4-mini for LLM classification
    prompt = build_categorization_prompt(txn)
    result = model_router.run(Task.CATEGORIZE, prompt)  # returns JSON
    parsed = parse_llm_category(result)

    # 3. Store result with confidence for later review
    return CategoryResult(
        category=parsed.category,
        source="llm",
        confidence=parsed.confidence
    )
```

### 8.3 Learning from corrections

When a user corrects a categorisation, the system:

1. Updates the transaction's category in PostgreSQL
2. Upserts a `CategoryRule` row: `merchant_normalized → category` with `confidence=1.0`
3. Retroactively re-categorises all past transactions from the same normalised merchant name
4. Decrements the LLM call count for that merchant in future uploads

Over time the rule cache grows and LLM calls decrease. After ~3 months of corrections a typical user reaches >80% rule-cache hit rate, making categorisation nearly instant.

### 8.4 Anomaly detection

On each new statement ingestion, the alert service computes per-merchant statistics from the last 6 months of transactions. Any new transaction with an amount > 2 standard deviations above the merchant mean is flagged as unusual and surfaces as an alert in the dashboard.

---

## 9. Investment Ledger

### 9.1 Supported instrument types

- Equity (listed shares)
- Unit trusts / mutual funds
- Exchange-traded funds (ETFs)
- Government bonds / treasury bills
- Fixed deposits
- Corporate bonds

### 9.2 Data model

Each investment is recorded as a series of **lots** (one lot per purchase). Sales are matched against lots using the selected lot identification method.

```
Investment
  ├── instrument_id (FK → Instrument)
  ├── account (broker / bank name)
  └── lots[]
       ├── buy_date
       ├── units
       ├── buy_price_per_unit
       ├── buy_currency
       ├── buy_fx_rate (to LKR at buy date)
       ├── fees
       └── sales[]
            ├── sell_date
            ├── units_sold
            ├── sell_price_per_unit
            └── sell_currency
```

### 9.3 Return calculations

**Unrealised gain/loss:**
```
unrealised_gl = (current_price - average_cost_basis) × units_held
```

**XIRR** is calculated using the `scipy` `xirr` function over the full cashflow series (all buys as negative, all sells + current value as positive). This is the most accurate single return metric for irregular investment timing.

**FX gain/loss separation:**
```
local_return = (current_price_lkr - buy_price_lkr) / buy_price_lkr
fx_component = (current_fx_rate - buy_fx_rate) / buy_fx_rate
investment_return = local_return - fx_component
```

### 9.4 NAV history import

When a unit trust performance report is ingested, the normalizer extracts the NAV time series and writes it to the `nav_history` table. The investment ledger service joins against this table to show the fund's full price history with the user's purchase price(s) overlaid on the chart.

---

## 10. Visualisation & Dashboard

### 10.1 Dashboard — home screen

- Net worth total (sum of all bank balances + investment portfolio value)
- Net worth over time (line chart, 1Y default)
- Portfolio allocation by instrument type (donut chart)
- Last month expense summary (category breakdown, bar chart)
- Active alerts (unusual spending, new subscriptions, portfolio drift)
- Recently ingested documents

### 10.2 Expense views

- Monthly category breakdown (stacked bar chart — one bar per month, categories stacked)
- Trend per category over time (multi-line chart)
- Transaction table with search, sort, filter by category/date/amount
- Inline category correction (click category badge → dropdown)

### 10.3 Investment views

- Holdings table: instrument, units, average cost, current price, unrealised G/L, XIRR
- Per-holding chart: price history (or NAV history for unit trusts) + purchase price overlay
- Portfolio performance vs benchmark (line chart, user selects benchmark)
- Lot-level detail on click: individual buy dates, prices, FX rates

### 10.4 Document chat

- Sidebar listing all ingested documents (filterable by type/institution/period)
- Optional document scope selector (ask about all docs, or scope to one)
- Streaming answer with source citations rendered inline
- Citation click scrolls to source context preview

### 10.5 Chart library

All charts use **Recharts** for React compatibility and composability. Key chart components:

```
NetWorthChart         → ComposedChart (area + line)
NavHistoryChart       → LineChart + ReferenceLine (purchase price)
ExpenseCategoryChart  → BarChart (stacked)
SpendingTrendChart    → LineChart (multi-series)
AllocationChart       → PieChart (donut variant)
BenchmarkChart        → LineChart (two series, normalised to 100 at start date)
```

---

## 11. Open Source Model Selection

All models run locally via Ollama (inference) and mlx-embeddings (embedding). No external API calls.

### 11.1 Model map

| Pipeline job | Model | Params | Quantized size | Speed (M3 Pro) | License |
|---|---|---|---|---|---|
| Document classifier | Qwen2.5-3B-Instruct | 3B | ~2 GB | ~48 tok/s | Apache 2.0 |
| Expense categorizer | Phi-4-mini-instruct | 3.8B | ~2.5 GB | ~40 tok/s | MIT |
| Structured extraction | SmolLM3-3B | 3B | ~2 GB | ~48 tok/s | Apache 2.0 |
| Embedding | BGE-M3 | 568M | ~2.2 GB | fast batch | MIT |
| Reranking | bge-reranker-base _(default)_ / bge-reranker-v2-m3 | 270M / 568M | ~0.5 GB / ~1.2 GB | fast / slow (CPU) | MIT |
| Financial Q&A | Qwen2.5-7B-Instruct | 7B | ~5 GB | ~24 tok/s | Apache 2.0 |
| Report summarisation | Qwen2.5-14B-Instruct | 14B | ~9 GB | ~15 tok/s | Apache 2.0 |
| Complex analysis | DeepSeek-R1-Distill-Qwen-7B | 7B | ~5 GB | ~21 tok/s | MIT |

### 11.2 Model routing logic

```python
# config.py
MODELS = {
    Task.CLASSIFY:   "qwen2.5:3b",
    Task.CATEGORIZE: "phi4-mini",
    Task.EXTRACT:    "smollm3:3b",
    Task.QA:         "qwen2.5:7b",
    Task.SUMMARIZE:  "qwen2.5:14b",
    Task.REASON:     "deepseek-r1:7b",
}
```

Ollama automatically evicts the previous model when a new one is loaded. Tasks of the same type are batched together during ingestion to minimise model swaps.

### 11.3 Embedding framework

BGE-M3 runs via **mlx-embeddings** rather than sentence-transformers. Apple's MLX framework is built from the ground up for Apple Silicon and uses Metal GPU directly, giving meaningfully faster batch throughput during large ingestion jobs.

```python
from mlx_embeddings import load, embed

model, tokenizer = load("BAAI/bge-m3")
vectors = embed(model, tokenizer, texts=chunk_texts)
```

### 11.4 Model pull script

```bash
#!/bin/bash
# scripts/pull_models.sh
ollama pull qwen2.5:3b
ollama pull phi4-mini
ollama pull smollm3:3b
ollama pull qwen2.5:7b
ollama pull qwen2.5:14b
ollama pull deepseek-r1:7b
```

---

## 12. Hardware Profile & Memory Budget

### 12.1 Target hardware

**MacBook Pro M3 Pro — 18GB unified memory**

- Memory bandwidth: 150 GB/s
- GPU cores: 18
- Metal acceleration: full support via Ollama + MLX
- Expected inference speed: 15–48 tok/s depending on model size

### 12.2 Memory budget

```
Component                    RAM usage
─────────────────────────────────────────
macOS + browser + apps       ~2.5 GB
BGE-M3 (always resident)     ~2.2 GB
bge-reranker (always res.)   ~1.2 GB
────────────────────────────────────────
Reserved overhead             ~5.9 GB
Available for active LLM     ~12.1 GB

Active model options:
  Qwen2.5-3B  Q4_K_M         ~2 GB    ← SLM jobs, very fast
  Phi-4-mini  Q4_K_M         ~2.5 GB  ← expense categorization
  Qwen2.5-7B  Q4_K_M         ~5 GB    ← financial Q&A
  Qwen2.5-14B Q4_K_M         ~9 GB    ← report summarisation (tight but fits)
  DeepSeek-R1-7B Q4_K_M      ~5 GB    ← complex reasoning
```

Maximum single model at this budget: **14B parameters at Q4 quantization**. Only one large model can be resident at a time — the model router handles sequential loading.

### 12.3 Ollama Metal configuration

```bash
export OLLAMA_METAL_ENABLED=1
export OLLAMA_NUM_GPU=1
export OLLAMA_MAX_LOADED_MODELS=1   # enforce single-model budget
launchctl setenv OLLAMA_METAL_ENABLED 1
```

---

## 13. Database Schema

### Core tables

```sql
-- Documents
CREATE TABLE documents (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    file_hash     VARCHAR(64) UNIQUE NOT NULL,    -- SHA-256
    doc_type      VARCHAR(32) NOT NULL,
    institution   VARCHAR(128),
    period_start  DATE,
    period_end    DATE,
    currency      VARCHAR(8),
    file_path     TEXT,
    ingested_at   TIMESTAMPTZ DEFAULT NOW(),
    status        VARCHAR(16) DEFAULT 'pending'   -- pending|processing|done|error
);

-- Transactions (from bank/credit card statements)
CREATE TABLE transactions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id       UUID REFERENCES documents(id),
    transaction_date  DATE NOT NULL,
    value_date        DATE,
    description       TEXT NOT NULL,
    merchant_raw      TEXT,
    merchant_normalized TEXT,
    amount            NUMERIC(14,2) NOT NULL,
    currency          VARCHAR(8),
    balance           NUMERIC(14,2),
    category          VARCHAR(64),
    category_source   VARCHAR(8),                 -- 'rule'|'llm'|'user'
    category_confidence NUMERIC(4,3),
    is_transfer       BOOLEAN DEFAULT FALSE,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Merchant category rules (learned from user corrections)
CREATE TABLE category_rules (
    merchant_normalized TEXT PRIMARY KEY,
    category            VARCHAR(64) NOT NULL,
    confidence          NUMERIC(4,3) DEFAULT 1.0,
    correction_count    INTEGER DEFAULT 0,
    last_updated        TIMESTAMPTZ DEFAULT NOW()
);

-- Instruments (equities, unit trusts, bonds, etc.)
CREATE TABLE instruments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    ticker      VARCHAR(32),
    isin        VARCHAR(12),
    type        VARCHAR(32) NOT NULL,             -- equity|unit_trust|etf|bond|fd
    currency    VARCHAR(8),
    exchange    VARCHAR(32)
);

-- Investment lots
CREATE TABLE investment_lots (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instrument_id   UUID REFERENCES instruments(id),
    account         VARCHAR(128),
    buy_date        DATE NOT NULL,
    units           NUMERIC(18,6) NOT NULL,
    buy_price       NUMERIC(14,4) NOT NULL,
    buy_currency    VARCHAR(8),
    buy_fx_rate     NUMERIC(14,6) DEFAULT 1.0,    -- rate to LKR at buy date
    fees            NUMERIC(14,2) DEFAULT 0,
    notes           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Sales (matched to lots)
CREATE TABLE investment_sales (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_id      UUID REFERENCES investment_lots(id),
    sell_date   DATE NOT NULL,
    units_sold  NUMERIC(18,6) NOT NULL,
    sell_price  NUMERIC(14,4) NOT NULL,
    sell_currency VARCHAR(8),
    sell_fx_rate  NUMERIC(14,6) DEFAULT 1.0,
    fees        NUMERIC(14,2) DEFAULT 0
);

-- NAV history (from unit trust performance reports)
CREATE TABLE nav_history (
    instrument_id UUID REFERENCES instruments(id),
    nav_date      DATE NOT NULL,
    nav_per_unit  NUMERIC(14,4) NOT NULL,
    document_id   UUID REFERENCES documents(id),
    PRIMARY KEY (instrument_id, nav_date)
);
```

---

## 14. API Design

All endpoints are prefixed with `/api/v1`. Streaming responses use Server-Sent Events (SSE).

### Documents

```
POST   /api/v1/documents/upload        # Upload PDF, returns doc_id
GET    /api/v1/documents               # List all documents
GET    /api/v1/documents/{id}          # Document detail + status
DELETE /api/v1/documents/{id}          # Delete document + all derived data
GET    /api/v1/documents/{id}/chunks   # Debug: show chunks for document
```

### Expenses

```
GET    /api/v1/expenses/transactions           # List with filters (date, category, amount)
PATCH  /api/v1/expenses/transactions/{id}      # Update category (triggers rule upsert)
GET    /api/v1/expenses/summary?month=2024-11  # Category totals for month
GET    /api/v1/expenses/trends?months=12       # Category amounts per month
GET    /api/v1/expenses/alerts                 # Anomaly alerts
```

### Investments

```
GET    /api/v1/investments/holdings            # All current holdings with P&L
POST   /api/v1/investments/lots                # Record new purchase lot
POST   /api/v1/investments/sales               # Record sale
GET    /api/v1/investments/performance         # Portfolio XIRR + nav history
GET    /api/v1/investments/{id}/history        # Price/NAV history for instrument
```

### Chat (streaming)

```
POST   /api/v1/chat/query              # SSE stream — question → answer + citations
Body: {
  "question": "What was Dialog's net profit in FY2024?",
  "institution": "Dialog Axiata",      # optional: filter by institution
  "period": "2024"                     # optional: filter by period
}
```

### Dashboard

```
GET    /api/v1/dashboard/summary       # Net worth, expense total, return summary
GET    /api/v1/dashboard/net-worth     # Net worth timeseries
```

---

## 15. Chunking Strategy

See [RAG System § 7.1](#71-chunking-strategy) for the full strategy. Quick reference:

| Content type | Chunk size | Overlap | Split on | Prefix format |
|---|---|---|---|---|
| Narrative text | 300–600 tokens | 50 tokens | Paragraph breaks | `[DocType \| Institution \| Period \| Section]` |
| Table rows | Header + 5–10 rows | None | Never mid-row | `[TableName \| Institution \| Period \| Currency]` |
| Metric snapshots | 50–150 tokens | None | N/A (one metric per chunk) | `[MetricName \| Institution \| Period]` |

**Key rule:** the context prefix is embedded into the chunk text itself (not only in metadata). This ensures the embedding captures entity context and retrieval works correctly even without metadata pre-filtering.

---

## 16. Execution Phases

### Phase 1 — Foundation (weeks 1–3)

- Set up repo, Docker Compose (PostgreSQL + Qdrant + Redis)
- SQLAlchemy models + Alembic migrations
- FastAPI skeleton with health check
- PDF ingestion pipeline for bank statements only (pdfplumber → normalizer → transaction rows)
- Basic expense list endpoint

**Milestone:** Upload a bank statement PDF and see parsed transactions in a table on the frontend.

### Phase 2 — Expense intelligence (weeks 4–6)

- Phi-4-mini expense categorisation via Ollama
- Merchant rule cache + learning loop
- Category correction UI (inline dropdown)
- Expense summary + trend endpoints
- ExpenseCategoryChart and SpendingTrendChart frontend components
- Anomaly detection + alerts

**Milestone:** Upload 3 months of statements, correct a few categories, see corrections applied retroactively.

### Phase 3 — RAG pipeline (weeks 7–9)

- MarkItDown integration for company reports + unit trust reports
- BGE-M3 embedding via mlx-embeddings
- Qdrant collections + hybrid search
- bge-reranker-v2-m3 reranking step
- Qwen2.5-7B Q&A with streaming SSE endpoint
- Chat UI with source citation display

**Milestone:** Upload a company annual report and ask "What was the revenue growth in FY2024?" — receive a cited answer.

### Phase 4 — Investment ledger (weeks 10–11)

- Instrument + lot + sale CRUD endpoints
- NAV history import from unit trust reports
- XIRR calculation with scipy
- FX rate tracking at lot level
- Investment holdings table frontend
- NavHistoryChart with purchase price overlay

**Milestone:** Record 5 investment lots, see XIRR and unrealised G/L per holding.

### Phase 5 — Dashboard & polish (weeks 12–14)

- Net worth timeseries aggregation
- NetWorthChart (bank balances + portfolio value)
- Portfolio allocation chart
- Benchmark comparison chart
- Brokerage statement parser (holdings + trades)
- Document management UI (upload, list, delete)
- Recurring transaction detection
- Monthly expense summary auto-generation

**Milestone:** Full dashboard showing net worth trend, expense breakdown, and portfolio performance in a single view.

---

## 17. Additional Feature Backlog

Features not in the initial scope but worth building after Phase 5:

**Tax lot optimisation** — when recording a sale, suggest which lots to use (FIFO, LIFO, or specific ID) based on their tax implications. Requires tracking each lot's holding period for capital gains classification.

**PDF deduplication at transaction level** — beyond file-level SHA-256 dedup, detect and merge duplicate transactions that appear in overlapping statement periods (e.g. December transactions appearing in both November and December statements).

**Multi-currency net worth** — normalise all holdings and balances to LKR using historical FX rates, with a live FX rate feed configurable for one or two currencies (USD, SGD, GBP most common for Sri Lankan investors).

**Export to CSV / Excel** — export transactions, holdings, or NAV history to CSV for accountants or personal spreadsheets.

**Scheduled report ingestion** — watch a local folder for new PDFs (e.g. a Downloads sync folder) and auto-ingest on detection using `watchdog`.

**Performance attribution** — break down portfolio return into: market return, allocation effect, and selection effect. Shows whether returns came from picking the right asset classes or the right instruments within them.

**Mobile app** — React Native wrapper around the same FastAPI backend for on-the-go expense review and investment recording.

---

## Environment Variables

```bash
# .env.example

# Database
DATABASE_URL=postgresql+asyncpg://financeos:financeos@localhost:5432/financeos

# Qdrant
QDRANT_HOST=localhost
QDRANT_PORT=6333

# Redis (Celery broker)
REDIS_URL=redis://localhost:6379/0

# Ollama
OLLAMA_BASE_URL=http://localhost:11434

# File storage
PDF_STORAGE_PATH=./storage/pdfs

# App
SECRET_KEY=change-me-in-production
DEBUG=true
```

---

## Getting Started

```bash
# 1. Clone the repo
git clone https://github.com/yourname/financeos.git
cd financeos

# 2. Start infrastructure
docker compose up -d

# 3. Install Python dependencies
pip install uv
uv sync

# 4. Set up database
python scripts/setup_db.py

# 5. Pull all AI models
bash scripts/pull_models.sh

# 6. Start backend
uvicorn backend.main:app --reload --port 8000

# 7. Install and start frontend
cd frontend
pnpm install
pnpm dev
```

Open `http://localhost:3000` to access the application.

---

*Document version: 1.0 — generated June 2026*
