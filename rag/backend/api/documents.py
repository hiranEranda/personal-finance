from fastapi import APIRouter, BackgroundTasks, HTTPException, UploadFile, File

from backend.ingestion import deduplicator
from backend.ingestion.pipeline import ingest_async, _run_ingestion
from backend.rag.vector_store import delete_by_doc_id

router = APIRouter(prefix="/api/v1/documents", tags=["documents"])


@router.post("/upload")
async def upload(file: UploadFile = File(...), background: BackgroundTasks = None):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    contents = await file.read()

    file_hash = deduplicator.compute_hash(contents)
    existing = deduplicator.find_by_hash(file_hash)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Already ingested on {existing.get('ingested_at', '?')} (doc_id: {existing['doc_id']})",
        )

    doc_id = deduplicator.register(file_hash, file.filename)

    # Heavy work runs in background so the response is immediate
    background.add_task(_run_ingestion, contents, doc_id, file.filename)

    return {"status": "processing", "doc_id": doc_id}


@router.get("")
def list_documents():
    return {"documents": deduplicator.list_all()}


@router.get("/{doc_id}")
def get_document(doc_id: str):
    doc = deduplicator.find_by_id(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")
    return doc


@router.delete("/{doc_id}")
def delete_document(doc_id: str):
    doc = deduplicator.find_by_id(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found.")

    delete_by_doc_id(doc_id)
    deduplicator.update(doc_id, status="deleted")
    return {"status": "deleted", "doc_id": doc_id}
