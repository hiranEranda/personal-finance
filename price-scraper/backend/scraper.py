"""Ported from data/unit_trust_daily_prices/utasl_scraper.py.

Scrapes utasl.lk's daily unit-price table. Pure HTTP/parsing — no file or DB
I/O here, callers decide what to do with the parsed rows.
"""

from __future__ import annotations

import re
from datetime import date

import requests
from bs4 import BeautifulSoup

from backend.config import settings

_HEADERS = {
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "x-requested-with": "XMLHttpRequest",
    "user-agent": "Mozilla/5.0",
}


def _new_session() -> requests.Session:
    session = requests.Session()
    session.headers.update(_HEADERS)
    return session


def _solve_js_gate(session: requests.Session, response: requests.Response) -> bool:
    """The site serves a 'Checking your browser' page that just sets a cookie
    via JS and reloads. If this response is that page, set the cookie on the
    session and return True so the caller can retry."""
    if "Checking your browser" not in response.text:
        return False
    m = re.search(r"document\.cookie\s*=\s*'([^=']+)=([^;']+)", response.text)
    if not m:
        raise RuntimeError("Browser-check page changed; could not extract its cookie.")
    session.cookies.set(m.group(1), m.group(2))
    return True


def _fetch(session: requests.Session, method: str, url: str, **kwargs) -> requests.Response:
    response = session.request(method, url, **kwargs)
    if _solve_js_gate(session, response):
        response = session.request(method, url, **kwargs)
    return response


def _get_fresh_nonce(session: requests.Session) -> str:
    response = _fetch(session, "GET", settings.utasl_page_url)
    m = re.search(r'uta_ajax\s*=\s*\{[^}]*?"nonce"\s*:\s*"([a-f0-9]+)"', response.text)
    if not m:
        raise RuntimeError("Could not find the uta_ajax nonce on the unit-prices page.")
    return m.group(1)


def _parse_html_table(html_content: str) -> list[dict]:
    if not html_content or "table" not in html_content:
        return []

    soup = BeautifulSoup(html_content, "html.parser")
    rows = soup.find_all("tr")
    data_list = []

    for row in rows:
        cols = row.find_all("td")
        if len(cols) == 4:

            def clean_num(text):
                num_str = text.get_text(strip=True).replace(",", "")
                try:
                    return float(num_str)
                except ValueError:
                    return None

            entry = {
                "company": cols[0].get_text(strip=True),
                "fund_name": cols[1].get_text(strip=True),
                "selling_price": clean_num(cols[2]),
                "buying_price": clean_num(cols[3]),
            }
            data_list.append(entry)
    return data_list


class Scraper:
    """Stateful wrapper (session + nonce) for scraping a run of consecutive days."""

    def __init__(self):
        self.session = _new_session()
        self.nonce = _get_fresh_nonce(self.session)

    def fetch_day(self, day: date) -> list[dict]:
        """Fetch and parse one day's table. Retries once with a fresh nonce if
        the server reports the current one expired."""
        date_str = day.strftime("%Y-%m-%d")
        payload = {
            "action": "filter_financial_data",
            "post_type": "unit_price",
            "dates[]": date_str,
            "nonce": self.nonce,
        }
        for attempt in range(2):
            response = _fetch(self.session, "POST", settings.utasl_url, data=payload)
            if response.status_code != 200:
                return []
            try:
                json_resp = response.json()
            except ValueError:
                text = response.text.strip()
                nonce_rejected = text in ["0", "-1", ""] or "security check" in text.lower()
                if nonce_rejected and attempt == 0:
                    self.nonce = _get_fresh_nonce(self.session)
                    payload["nonce"] = self.nonce
                    continue
                raise RuntimeError(f"Server did not return JSON for {date_str}: '{response.text.strip()[:200]}'")
            html_snippet = json_resp.get("data", {}).get("html", "")
            return _parse_html_table(html_snippet)
        return []
