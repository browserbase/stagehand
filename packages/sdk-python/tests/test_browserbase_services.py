from __future__ import annotations

from types import SimpleNamespace
from typing import Self

import pytest

from stagehand import browserbase_services
from stagehand.client_models import _BrowserbaseFetchOptions, _BrowserbaseSearchOptions


class FakeAsyncBrowserbase:
    configurations: list[tuple[str, str]] = []
    search_calls: list[dict[str, object]] = []
    fetch_calls: list[dict[str, object]] = []

    def __init__(self, *, api_key: str, base_url: str) -> None:
        self.configurations.append((api_key, base_url))
        self.search = SimpleNamespace(web=self._search)
        self.fetch_api = SimpleNamespace(create=self._fetch)

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def _search(self, **kwargs: object) -> SimpleNamespace:
        self.search_calls.append(kwargs)
        return SimpleNamespace(
            query="browser agents",
            request_id="request_123",
            results=[
                SimpleNamespace(
                    id="result_123",
                    title="Stagehand",
                    url="https://stagehand.dev",
                    author=None,
                    favicon=None,
                    image=None,
                    published_date=None,
                )
            ],
        )

    async def _fetch(self, **kwargs: object) -> SimpleNamespace:
        self.fetch_calls.append(kwargs)
        return SimpleNamespace(
            id="fetch_123",
            content="# Stagehand",
            content_type="text/markdown",
            encoding="utf-8",
            headers={"content-type": "text/html"},
            status_code=200,
        )


async def test_browserbase_services_proxy_official_sdk(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    FakeAsyncBrowserbase.configurations.clear()
    FakeAsyncBrowserbase.search_calls.clear()
    FakeAsyncBrowserbase.fetch_calls.clear()
    monkeypatch.setattr(browserbase_services, "AsyncBrowserbase", FakeAsyncBrowserbase)

    search = await browserbase_services.search_browserbase(
        _BrowserbaseSearchOptions(
            api_key="bb_key",
            base_url="https://api.dev.browserbase.com",
            query="browser agents",
            num_results=5,
        )
    )
    fetch = await browserbase_services.fetch_browserbase(
        _BrowserbaseFetchOptions(
            api_key="bb_key",
            base_url="https://api.dev.browserbase.com",
            url="https://stagehand.dev",
            format="markdown",
        )
    )

    assert search.request_id == "request_123"
    assert fetch.status_code == 200
    assert FakeAsyncBrowserbase.configurations == [
        ("bb_key", "https://api.dev.browserbase.com"),
        ("bb_key", "https://api.dev.browserbase.com"),
    ]
    assert FakeAsyncBrowserbase.search_calls == [{"query": "browser agents", "num_results": 5}]
    assert FakeAsyncBrowserbase.fetch_calls == [
        {"url": "https://stagehand.dev", "format": "markdown"}
    ]


def test_browserbase_services_validate_request_constraints() -> None:
    with pytest.raises(ValueError):
        _BrowserbaseSearchOptions(api_key="bb_key", query="q" * 201)

    with pytest.raises(ValueError, match='schema is only valid when format is "json"'):
        _BrowserbaseFetchOptions(
            api_key="bb_key",
            url="https://stagehand.dev",
            format="markdown",
            schema={"type": "object"},
        )

    with pytest.raises(ValueError, match='schema is required when format is "json"'):
        _BrowserbaseFetchOptions(
            api_key="bb_key",
            url="https://stagehand.dev",
            format="json",
        )

    options = _BrowserbaseFetchOptions(
        api_key="bb_key",
        url="https://stagehand.dev",
        format="json",
        schema={"type": "object"},
    )
    assert options.json_schema == {"type": "object"}
