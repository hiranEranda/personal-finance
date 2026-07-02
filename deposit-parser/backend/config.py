from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://postgres@localhost:5432/financeos"

    cal_ut_dir: Path = Path("/data/cal_ut")
    ndbw_ut_dir: Path = Path("/data/ndbw")

    # Real value lives in deposit-parser/.env (gitignored) — never hardcode a
    # real password here, this file is committed to source control.
    cal_ut_pdf_password: str = ""

    model_config = {"env_file": ".env"}


settings = Settings()
