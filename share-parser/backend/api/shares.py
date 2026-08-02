from fastapi import APIRouter, File, UploadFile

from backend import sync_service

router = APIRouter(prefix="/api/v1/shares", tags=["shares"])


@router.post("/sync")
def sync():
    return sync_service.run_sync()


@router.post("/upload")
async def upload(files: list[UploadFile] = File(...)):
    payload = [(f.filename, await f.read()) for f in files]
    return sync_service.ingest_uploads(payload)
