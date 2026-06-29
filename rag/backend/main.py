import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.chat import router as chat_router
from backend.api.documents import router as documents_router
from backend.db.connection import close_pool, init_pool

LOG_FILE = Path(__file__).parent.parent / "server.log"

_file_handler = logging.FileHandler(LOG_FILE)
_file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)-8s %(name)s: %(message)s"))
_file_handler.setLevel(logging.DEBUG)

for _log_name in ("uvicorn.access", "uvicorn.error", "fastapi", "backend"):
    _log = logging.getLogger(_log_name)
    if _file_handler not in _log.handlers:
        _log.addHandler(_file_handler)
    _log.setLevel(logging.DEBUG)

logger = logging.getLogger("backend")


@asynccontextmanager
async def lifespan(app: FastAPI):
    import asyncio
    from backend.ingestion.embedder import embed_query
    from backend.rag.reranker import _get_reranker

    # Connect to PostgreSQL
    init_pool()

    # Pre-warm embedding and reranker models so the first user query isn't slow.
    logger.info("[STARTUP ] Pre-warming embedding model...")
    await asyncio.to_thread(embed_query, "warmup")
    logger.info("[STARTUP ] Pre-warming reranker model...")
    await asyncio.to_thread(_get_reranker)
    logger.info("[STARTUP ] Models ready — server accepting requests")
    yield

    close_pool()


app = FastAPI(
    title="FinanceOS RAG — Company Financials",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://localhost:4200"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(documents_router)
app.include_router(chat_router)


@app.get("/health")
def health():
    return {"status": "ok"}
