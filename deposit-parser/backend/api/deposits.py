from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend import sync_service

router = APIRouter(prefix="/api/v1/deposits", tags=["deposits"])


class MapRequest(BaseModel):
    fund_id: str


@router.post("/sync")
def sync():
    return sync_service.run_sync()


@router.get("/review")
def review_queue():
    return {"items": sync_service.list_review_queue()}


@router.post("/review/{review_id}/map")
def map_review_item(review_id: str, body: MapRequest):
    try:
        return sync_service.resolve_review_item(review_id, body.fund_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
