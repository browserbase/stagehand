from __future__ import annotations

from browserbase import AsyncBrowserbase

from .client_models import (
    BrowserbaseFetchResult,
    BrowserbaseSearchResult,
    BrowserbaseSearchResultItem,
    _BrowserbaseFetchOptions,
    _BrowserbaseSearchOptions,
)


async def search_browserbase(options: _BrowserbaseSearchOptions) -> BrowserbaseSearchResult:
    async with AsyncBrowserbase(api_key=options.api_key, base_url=options.base_url) as client:
        response = await client.search.web(
            query=options.query,
            **({"num_results": options.num_results} if options.num_results is not None else {}),
        )
    return BrowserbaseSearchResult(
        query=response.query,
        request_id=response.request_id,
        results=[
            BrowserbaseSearchResultItem(
                id=result.id,
                title=result.title,
                url=result.url,
                author=result.author,
                favicon=result.favicon,
                image=result.image,
                published_date=(
                    result.published_date.isoformat() if result.published_date is not None else None
                ),
            )
            for result in response.results
        ],
    )


async def fetch_browserbase(options: _BrowserbaseFetchOptions) -> BrowserbaseFetchResult:
    request = options.model_dump(
        exclude={"api_key", "base_url"},
        exclude_none=True,
        by_alias=True,
    )
    async with AsyncBrowserbase(api_key=options.api_key, base_url=options.base_url) as client:
        response = await client.fetch_api.create(**request)
    return BrowserbaseFetchResult(
        id=response.id,
        content=response.content,
        content_type=response.content_type,
        encoding=response.encoding,
        headers=response.headers,
        status_code=response.status_code,
    )
