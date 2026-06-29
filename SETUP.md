# FinanceOS — Setup Guide

Complete setup instructions for a fresh machine. Follow the sections in order — each one is a dependency of the next.

**Platform:** macOS (Apple Silicon). All tool versions are what's tested on this project.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Get the code](#2-get-the-code)
3. [PostgreSQL](#3-postgresql)
4. [Qdrant (vector database)](#4-qdrant-vector-database)
5. [Python RAG backend](#5-python-rag-backend)
6. [Ollama models](#6-ollama-models)
7. [Node BFF server](#7-node-bff-server)
8. [Angular frontend](#8-angular-frontend)
9. [Starting the app (every day)](#9-starting-the-app-every-day)
10. [Migrating existing data](#10-migrating-existing-data)
11. [Verify everything works](#11-verify-everything-works)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prerequisites

Install these once. If you already have a tool, check the minimum version.

### Homebrew

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/homebrew/install/HEAD/install.sh)"
```

### Python 3.11+

```bash
brew install python@3.12
python3 --version   # should print 3.11 or higher
```

### uv (Python package manager)

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
# restart your terminal, then:
uv --version
```

### Node.js 20+

```bash
brew install node
node --version   # should print v20 or higher
```

### PostgreSQL 15+

```bash
brew install postgresql@15
brew services start postgresql@15
# add to PATH (add to ~/.zshrc to make permanent):
export PATH="/opt/homebrew/opt/postgresql@15/bin:$PATH"
psql --version   # should print psql (PostgreSQL) 15.x
```

### Docker Desktop

Download and install from https://www.docker.com/products/docker-desktop/

```bash
docker --version   # should print 24+
```

### Ollama

```bash
brew install ollama
ollama --version
```

---

## 2. Get the code

```bash
git clone <your-repo-url>
cd personal-finance
```

All commands in this guide are run from the `personal-finance/` directory unless a `cd` says otherwise.

---

## 3. PostgreSQL

### 3.1 Create the database

```bash
createdb financeos
```

Verify it was created:

```bash
psql -l | grep financeos
```

You should see `financeos` in the list.

### 3.2 Configure the connection URL

Copy the env template:

```bash
cp rag/.env.example rag/.env
```

Open `rag/.env` and check the `DATABASE_URL` line. The default works if you installed PostgreSQL via Homebrew and your macOS username is the superuser:

```
DATABASE_URL=postgresql://postgres@localhost:5432/financeos
```

If `psql -U postgres` gives an error, use your macOS username instead:

```
DATABASE_URL=postgresql://<your-macos-username>@localhost:5432/financeos
```

To find your username:

```bash
whoami
```

### 3.3 Apply the schema migrations

The migration scripts use `psycopg2` which lives inside the uv venv. Run them through `uv run`:

```bash
cd rag
uv run python ../database/migrate.py
cd ..
```

Expected output:

```
  Applying 001_documents.sql ... done
  Applying 002_chat.sql ... done

2 migration(s) applied successfully.
```

Safe to re-run at any time — already-applied files are skipped.

### 3.4 Verify the tables exist

```bash
psql financeos -c "\dt"
```

You should see:

```
             List of relations
 Schema |       Name        | Type  |  Owner
--------+-------------------+-------+----------
 public | chat_messages     | table | ...
 public | chat_sessions     | table | ...
 public | chat_sources      | table | ...
 public | documents         | table | ...
 public | schema_migrations | table | ...
```

---

## 4. Qdrant (vector database)

Qdrant stores the document embeddings. It runs in Docker.

```bash
cd rag
docker compose up -d
cd ..
```

Verify it's running:

```bash
curl -s http://localhost:6333/healthz
# should return: {"status":"ok","time":...}
```

> **Note:** Qdrant data is stored in a Docker volume (`qdrant_storage`). It persists across restarts. To wipe all vectors and start fresh: `docker compose down -v`.

---

## 5. Python RAG backend

### 5.1 Create the virtual environment and install dependencies

```bash
cd rag
uv sync
cd ..
```

This creates `.venv/` inside `rag/` and installs all Python dependencies including `psycopg2-binary`, `FlagEmbedding`, `fastapi`, etc. It takes a few minutes on first run.

### 5.2 Verify the environment

```bash
cd rag
uv run python -c "import psycopg2, fastapi, FlagEmbedding; print('OK')"
cd ..
```

### 5.3 Start the backend

```bash
cd rag
uv run uvicorn backend.main:app --reload --port 8000
```

On first start you will see the models being pre-warmed:

```
[STARTUP ] Initialising connection pool...
[STARTUP ] Pool ready
[STARTUP ] Pre-warming embedding model...
[STARTUP ] Pre-warming reranker model...
[STARTUP ] Models ready — server accepting requests
```

The embedding model (BGE-M3, ~2 GB) and reranker (~0.5 GB) auto-download from HuggingFace on first run. This takes 5–15 minutes depending on your connection. Subsequent starts are instant.

Verify it's running:

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

---

## 6. Ollama models

The RAG backend needs two Ollama models. Pull them while the backend is starting (they download in parallel).

```bash
# Open a new terminal tab, then:
ollama pull qwen2.5:3b   # document classifier (~2 GB)
ollama pull qwen2.5:7b   # Q&A generation (~4.7 GB)
```

Verify:

```bash
ollama list
# should show both qwen2.5:3b and qwen2.5:7b
```

> Ollama must be running when the RAG backend is running. Start it with `ollama serve` if it's not already running as a service. On macOS it usually starts automatically after install.

---

## 7. Node BFF server

The Node server sits between the Angular frontend and the FastAPI backend, proxying RAG requests and serving the investment fund data API.

```bash
cd server
npm install
node server.js
```

You should see:

```
Server is running on port 3001
```

Leave this running. Open a new terminal for the next step.

---

## 8. Angular frontend

```bash
cd web
npm install
npm start
```

You should see:

```
Application bundle generation complete. [X.XXX seconds]
Local:   http://localhost:4200/
```

Open `http://localhost:4200` in your browser.

---

## 9. Starting the app (every day)

After the one-time setup, you need four processes running. Open four terminal tabs:

**Tab 1 — Qdrant**
```bash
cd personal-finance/rag
docker compose up
```

**Tab 2 — RAG backend**
```bash
cd personal-finance/rag
uv run uvicorn backend.main:app --reload --port 8000
```

**Tab 3 — Node BFF**
```bash
cd personal-finance/server
node server.js
```

**Tab 4 — Angular frontend**
```bash
cd personal-finance/web
npm start
```

Open `http://localhost:4200`.

> **Tip:** Ollama runs as a macOS background service after install and starts automatically on login. If chat queries fail with a model error, run `ollama serve` in a separate terminal.

---

## 10. Migrating existing data

Only relevant if you used the app before the PostgreSQL integration (when documents were stored in `rag/storage/documents.json`).

### 10.1 Import documents from documents.json

```bash
cd rag
uv run python ../database/migrate_from_json.py
cd ..
```

This reads every record from `documents.json` and inserts it into the `documents` table. It prints a per-row status and skips anything already in the DB. The original `documents.json` is not deleted.

### 10.2 What this does NOT migrate

The Qdrant vectors for those documents are already there — they were stored when the files were originally uploaded. You don't need to re-ingest the PDFs. The migration only moves the registry metadata (filename, status, institution, period, chunk count) into PostgreSQL so the frontend can list documents correctly.

### 10.3 Verify

```bash
psql financeos -c "SELECT filename, status, institution, chunk_count FROM documents;"
```

---

## 11. Verify everything works

Run through this checklist after setup:

```bash
# PostgreSQL
psql financeos -c "SELECT COUNT(*) FROM documents;"

# Qdrant
curl -s http://localhost:6333/healthz

# RAG backend
curl http://localhost:8000/health

# Documents API (via Node proxy)
curl http://localhost:3001/api/rag/documents

# Chat sessions API
curl http://localhost:3001/api/rag/chat/sessions
```

All should return JSON without errors. Then open the browser at `http://localhost:4200` and:

1. Go to **Documents** — your previously ingested files should be listed
2. Go to **Chat** — ask "What documents do we have?" — you should get a list back
3. Ask a follow-up question — the `session_id` from the first answer is passed automatically, starting your chat history

---

## 12. Troubleshooting

### `createdb: error: connection to server failed`

PostgreSQL isn't running. Start it:

```bash
brew services start postgresql@15
```

### `psql: error: role "postgres" does not exist`

Homebrew PostgreSQL uses your macOS username as the default superuser. Update `DATABASE_URL` in `rag/.env`:

```
DATABASE_URL=postgresql://<your-macos-username>@localhost:5432/financeos
```

### Migration scripts fail with `psycopg2 not found`

The migration scripts must run through the uv venv, not the system Python. Use:

```bash
cd rag
uv run python ../database/migrate.py
# or
uv run python ../database/migrate_from_json.py
```

If `uv sync` hasn't been run yet, do that first (step 5.1).

### RAG backend fails to start: `DB pool not initialised`

The `DATABASE_URL` in `rag/.env` is wrong or the database doesn't exist. Check:

```bash
psql $DATABASE_URL -c "SELECT 1"
```

### Chat returns "No relevant documents found"

The PDF was ingested before the DB integration and the registry row doesn't exist in PostgreSQL. Run the data migration:

```bash
python database/migrate_from_json.py
```

### Qdrant connection refused

Docker isn't running or the container stopped. Check:

```bash
docker ps | grep qdrant
# if missing:
cd personal-finance/rag && docker compose up -d
```

### First startup is very slow (5–15 min)

Normal — the embedding model (BGE-M3, ~2 GB) and reranker are downloading from HuggingFace. You'll see `[STARTUP] Models ready` when done. Only happens once per machine.

### Ollama model not found error during chat

```bash
ollama list   # check models are present
ollama pull qwen2.5:7b   # re-pull if missing
```

---

## Environment variables reference

All configuration lives in `rag/.env`. Copy from `rag/.env.example` and adjust.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres@localhost:5432/financeos` | PostgreSQL connection string |
| `QDRANT_HOST` | `localhost` | Qdrant hostname |
| `QDRANT_PORT` | `6333` | Qdrant port |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API base URL |
| `PDF_STORAGE_PATH` | `./storage/pdfs` | Where raw PDFs are archived |
| `CLASSIFIER_MODEL` | `qwen2.5:3b` | Ollama model for document classification |
| `QA_MODEL` | `qwen2.5:7b` | Ollama model for Q&A generation |
| `EMBEDDING_MODEL` | `BAAI/bge-m3` | HuggingFace embedding model |
| `RERANKER_MODEL` | `BAAI/bge-reranker-base` | HuggingFace reranker model |
| `RETRIEVAL_TOP_K` | `20` | Candidates retrieved before reranking |
| `RERANK_TOP_K` | `5` | Chunks passed to the LLM after reranking |
| `CLASSIFIER_CONFIDENCE_THRESHOLD` | `0.75` | Min confidence to ingest a document |

---

## Project structure at a glance

```
personal-finance/
├── SETUP.md                    ← this file
├── PROGRESS.md                 ← what's built and what's next
├── database/
│   ├── 001_documents.sql       ← documents table DDL
│   ├── 002_chat.sql            ← chat tables DDL
│   ├── migrate.py              ← applies SQL migrations in order
│   └── migrate_from_json.py    ← one-time import from documents.json
├── docs/
│   └── rag-system.md           ← RAG architecture deep-dive
├── rag/                        ← FastAPI RAG backend (Python)
│   ├── .env                    ← your local config (not in git)
│   ├── .env.example            ← template — copy to .env
│   ├── pyproject.toml          ← Python dependencies
│   ├── docker-compose.yml      ← Qdrant container
│   ├── backend/
│   │   ├── db/                 ← PostgreSQL connection + repos
│   │   ├── ingestion/          ← PDF parsing pipeline
│   │   └── rag/                ← retrieval, reranking, Q&A
│   └── storage/pdfs/           ← raw PDF archive (gitignored)
├── server/                     ← Node.js BFF (Express)
│   └── server.js               ← proxies /api/rag → FastAPI :8000
└── web/                        ← Angular frontend
    └── src/app/pages/
        ├── rag-documents/      ← PDF upload + document list
        └── rag-chat/           ← chat Q&A interface
```
