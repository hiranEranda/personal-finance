from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend import sync_service

router = APIRouter(prefix="/api/v1/sync", tags=["sync"])


class BackfillRequest(BaseModel):
    months: int


@router.post("/incremental")
def sync_incremental():
    try:
        return sync_service.run_incremental_sync()
    except sync_service.GapTooLargeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.post("/backfill")
def sync_backfill(body: BackfillRequest):
    if body.months <= 0:
        raise HTTPException(status_code=400, detail="months must be positive")
    job_id = sync_service.start_backfill(body.months)
    return {"job_id": job_id}


@router.get("/backfill/{job_id}")
def get_backfill_status(job_id: str):
    job = sync_service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Unknown job_id")
    return job
