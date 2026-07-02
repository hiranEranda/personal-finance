from pathlib import Path
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://financeos:financeos@localhost:5432/financeos"

    qdrant_host: str = "localhost"
    qdrant_port: int = 6333

    ollama_base_url: str = "http://localhost:11434"

    pdf_storage_path: Path = Path("./storage/pdfs")

    classifier_model: str = "qwen2.5:3b"
    rewriter_model: str = "qwen2.5:3b"
    qa_model: str = "qwen2.5:7b"
    embedding_model: str = "BAAI/bge-m3"
    reranker_model: str = "BAAI/bge-reranker-base"

    collection_name: str = "company_financials"
    classifier_confidence_threshold: float = 0.75
    retrieval_top_k: int = 10
    rerank_top_k: int = 5

    model_config = {"env_file": ".env"}


settings = Settings()
