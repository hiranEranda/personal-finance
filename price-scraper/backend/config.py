from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://postgres@localhost:5432/financeos"

    utasl_url: str = "https://www.utasl.lk/wp-admin/admin-ajax.php"
    utasl_page_url: str = "https://www.utasl.lk/unit-prices/"

    model_config = {"env_file": ".env"}


settings = Settings()
