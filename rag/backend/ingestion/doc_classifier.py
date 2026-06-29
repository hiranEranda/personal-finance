import json
import httpx
from backend.config import settings

_PROMPT = """You are a financial document classifier. Analyze the beginning of this document and classify it.

Return ONLY a JSON object with these exact fields:
{{
  "doc_type": "<one of: company_annual_report, bank_statement, unit_trust_report, brokerage_statement, unknown>",
  "institution": "<company or bank name>",
  "period_start": "<YYYY-MM-DD or null>",
  "period_end": "<YYYY-MM-DD or null>",
  "currency": "<currency code e.g. LKR, USD, or null>",
  "confidence": <float 0.0 to 1.0>
}}

Document content:
{content}"""


def classify(text: str) -> dict:
    excerpt = text[:3000]

    try:
        response = httpx.post(
            f"{settings.ollama_base_url}/api/generate",
            json={
                "model": settings.classifier_model,
                "prompt": _PROMPT.format(content=excerpt),
                "stream": False,
                "format": "json",
            },
            timeout=90.0,
        )
        response.raise_for_status()
        raw = response.json().get("response", "{}")
        result = json.loads(raw)
    except (httpx.HTTPError, json.JSONDecodeError, KeyError):
        result = {"doc_type": "unknown", "confidence": 0.0}

    return result
