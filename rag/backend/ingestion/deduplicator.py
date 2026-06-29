"""
Document deduplication — public interface unchanged, backed by PostgreSQL.

All callers (pipeline.py, documents.py) continue to work without changes.
The old documents.json file is no longer read or written.
"""

import hashlib
from typing import Optional

from backend.db import documents_repo


def compute_hash(file_bytes: bytes) -> str:
    return hashlib.sha256(file_bytes).hexdigest()


def find_by_hash(file_hash: str) -> Optional[dict]:
    return documents_repo.find_by_hash(file_hash)


def find_by_id(doc_id: str) -> Optional[dict]:
    return documents_repo.find_by_id(doc_id)


def list_all() -> list[dict]:
    return documents_repo.list_all()


def register(file_hash: str, filename: str) -> str:
    return documents_repo.register(file_hash, filename)


def update(doc_id: str, **kwargs) -> None:
    documents_repo.update(doc_id, **kwargs)
