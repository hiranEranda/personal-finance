from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://postgres@localhost:5432/financeos"

    # CSE broker contract notes (BOUGHT/SOLD) — same folder the frontend's Add
    # button saves uploads into and Sync re-scans. Paths are relative to
    # share-parser/ locally; docker-compose mounts /data/share_bought and
    # /data/share_sold the same way deposit-parser mounts its PDF folders.
    bought_dir: Path = Path("../reciepts/bought")
    sold_dir: Path = Path("../reciepts/sold")

    model_config = {"env_file": ".env"}


settings = Settings()
