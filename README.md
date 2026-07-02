# FinanceOS

A local-first personal finance app: unit trust funds, CSE shares, fixed deposits,
and AI-assisted document Q&A, all backed by one PostgreSQL database.

## Components

| Component | What it does | Tech | Runs |
|---|---|---|---|
| `web/` | UI — Funds, Shares, Fixed Deposits, Analytics, Compare, Forecast, RAG chat, cross-domain dashboard | Angular 21 | container (`:4200`) |
| `server/` | API gateway — funds/transactions/nav-history, share portfolio, fixed deposits; proxies `/api/rag`, `/api/prices`, `/api/deposits` to the services below | Node/Express | container (`:3001`) |
| `rag/` | Document ingestion + Q&A chat over your financial PDFs (BGE-M3 embeddings, reranking, Ollama for chat) | Python/FastAPI | **native** (`:8000`) — needs Metal GPU |
| `price-scraper/` | Syncs daily unit trust NAVs from utasl.lk into `nav_history` (incremental + backfill) | Python/FastAPI | container (`:8001`) |
| `deposit-parser/` | Parses bank deposit-confirmation PDFs into fund `transactions`, with a review queue for unmatched fund names | Python/FastAPI | container (`:8002`) |
| `database/` | SQL migrations (`NNN_*.sql`) + one-off historical data-migration scripts | SQL / Python | run via `migrate.py` |
| Postgres | Single database (`financeos`) — source of truth for everything above | Postgres 16 | container (`:5432`) |
| Qdrant | Vector store for RAG document embeddings | Qdrant | container (`:6333`) |
| Ollama | Local LLM for RAG chat (`qwen2.5:3b`/`7b`) | Ollama | **native** (`:11434`) — needs Metal GPU |

`rag/` and Ollama run natively (not in Docker) specifically to keep Metal GPU
acceleration for embeddings, reranking, and chat inference — Docker Desktop's
Linux VM has no GPU access, which would make both noticeably slower. Everything
else runs via `docker compose`.

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- [Ollama](https://ollama.com/) — native install, not the Docker image
- [uv](https://docs.astral.sh/uv/) — for running `rag/` and the migration scripts

## Start the application

```bash
# 1. Pull the models rag/ needs for chat
ollama pull qwen2.5:3b
ollama pull qwen2.5:7b

# 2. Start Postgres, Qdrant, the API server, web UI, price-scraper, deposit-parser
cd personal-finance
docker compose up -d

# 3. Apply database migrations (idempotent — safe to re-run)
uv run --project rag python database/migrate.py

# 4. Start the RAG backend natively (separate terminal — needs GPU access)
cd rag
uv sync
uv run uvicorn backend.main:app --reload --port 8000
```

Open **http://localhost:4200**.

### Config

`rag/.env` is the single source of truth for `DATABASE_URL` and is also read by
the migration scripts and (for the containers) overridden via `docker-compose.yml`
environment variables so they resolve `postgres`/`qdrant` by service name instead
of `localhost`. Copy `rag/.env.example` to `rag/.env` and adjust if needed —
defaults work out of the box with the compose file's Postgres credentials
(`postgres`/no password, trust auth, database `financeos`).

## Day-to-day

```bash
docker compose ps                    # what's running
docker compose logs -f server        # tail a service's logs
docker compose up -d --build <name>  # rebuild one service after a Dockerfile/dep change
docker compose down                  # stop everything (data persists — see below)
```

Source for the containerized services is bind-mounted, so editing `web/`,
`server/`, `price-scraper/`, or `deposit-parser/` hot-reloads without a rebuild.
Only `docker compose up -d --build` is needed after changing a `Dockerfile` or
`pyproject.toml`/`package.json` dependencies.

### Data persistence

Postgres and Qdrant data live in `infra/postgres-data/` and `infra/qdrant-data/`
(bind-mounted, not Docker volumes) — they survive `docker compose down` and are
visible/backup-able as normal files on disk.

## Directory structure

```
personal-finance/
├── docker-compose.yml       # postgres, qdrant, server, web, price-scraper, deposit-parser
├── database/                # SQL migrations + one-off data-migration scripts
├── infra/                   # bind-mounted postgres/qdrant data, DB backups
├── web/                     # Angular frontend
├── server/                  # Express API gateway
├── rag/                     # FastAPI RAG backend (native)
├── price-scraper/           # FastAPI price-sync service (container)
└── deposit-parser/          # FastAPI deposit-confirmation parser (container)
```

## How the pieces fit together

- **Funds**: `funds`/`transactions`/`nav_history` tables. `price-scraper` keeps
  `nav_history` current; `deposit-parser` turns bank confirmation PDFs into
  `transactions`. Both match external fund names to your funds via a shared
  `fund_name_aliases` table — first match needs manual confirmation (a review
  queue for deposits, silent skip for prices since no money is at stake),
  every match after that is automatic.
- **Shares**: `share_*` tables, single-document save/load from the Shares page.
- **Fixed Deposits**: `fixed_deposits` table, plain CRUD. Value is principal
  until the maturity date is reached (no early withdrawal), then the full
  matured value (Actual/365 simple interest) — that's what feeds the net worth
  total on the dashboard.
- **RAG**: uploaded PDFs → `documents` table + Qdrant embeddings → chat queries
  retrieve + rerank + answer via Ollama.
