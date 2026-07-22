from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from pathlib import Path

from ._generated.models import (
    ClearCookieOptions,
    ContextActivePageResult,
    ContextAddCookiesParams,
    ContextAddInitScriptParams,
    ContextClearCookiesParams,
    ContextCloseResult,
    ContextCookiesParams,
    ContextCookiesResult,
    ContextGetDomainPolicyResult,
    ContextNewPageParams,
    ContextPagesResult,
    ContextSetActivePageParams,
    ContextSetDomainPolicyParams,
    ContextSetExtraHTTPHeadersParams,
    ContextVoidResult,
    Cookie,
    CookieFilter,
    CookieParam,
    CookieRegex,
    DomainPolicy,
    EmptyParams,
    PageRef,
)
from .browser_clipboard import BrowserClipboard
from .page import Page
from .rpc_client import RPCClient


class BrowserContext:
    def __init__(self, rpc_client: RPCClient) -> None:
        self._rpc_client = rpc_client
        self._clipboard: BrowserClipboard | None = None

    @property
    def clipboard(self) -> BrowserClipboard:
        if self._clipboard is None:
            self._clipboard = BrowserClipboard(self._rpc_client)
        return self._clipboard

    async def pages(self) -> list[Page]:
        result = await self._rpc_client.send(
            "context.pages",
            EmptyParams(),
            ContextPagesResult,
        )
        return [Page(self._rpc_client, page_ref) for page_ref in result.root]

    async def new_page(self, *, url: str | None = None) -> Page:
        params = ContextNewPageParams()
        if url is not None:
            params.url = url
        page_ref = await self._rpc_client.send("context.new_page", params, PageRef)
        return Page(self._rpc_client, page_ref)

    async def active_page(self) -> Page | None:
        result = await self._rpc_client.send(
            "context.active_page",
            EmptyParams(),
            ContextActivePageResult,
        )
        return None if result.root is None else Page(self._rpc_client, result.root)

    async def set_active_page(self, page: Page) -> None:
        await self._rpc_client.send(
            "context.set_active_page",
            ContextSetActivePageParams(page_id=page.page_id),
            ContextVoidResult,
        )

    async def close(self) -> None:
        """Close the remote context; use Stagehand.close() to release local resources."""
        await self._rpc_client.send(
            "context.close",
            EmptyParams(),
            ContextCloseResult,
        )

    async def add_init_script(self, source: str | Path) -> None:
        if isinstance(source, Path):
            source_url = str(source).replace("\n", "")
            script = f"{source.read_text()}\n//# sourceURL={source_url}"
        else:
            script = source
        await self._rpc_client.send(
            "context.add_init_script",
            ContextAddInitScriptParams(source=script),
            ContextVoidResult,
        )

    async def set_extra_http_headers(self, headers: Mapping[str, str]) -> None:
        await self._rpc_client.send(
            "context.set_extra_http_headers",
            ContextSetExtraHTTPHeadersParams(headers=dict(headers)),
            ContextVoidResult,
        )

    async def get_domain_policy(self) -> DomainPolicy | None:
        result = await self._rpc_client.send(
            "context.get_domain_policy",
            EmptyParams(),
            ContextGetDomainPolicyResult,
        )
        return result.policy

    async def set_domain_policy(self, policy: DomainPolicy | None) -> None:
        await self._rpc_client.send(
            "context.set_domain_policy",
            ContextSetDomainPolicyParams(policy=policy),
            ContextVoidResult,
        )

    async def cookies(self, urls: str | Sequence[str] | None = None) -> list[Cookie]:
        params = ContextCookiesParams()
        if urls is not None:
            params.urls = list(urls) if not isinstance(urls, str) else urls
        result = await self._rpc_client.send(
            "context.cookies",
            params,
            ContextCookiesResult,
        )
        return result.cookies

    async def add_cookies(self, cookies: Sequence[CookieParam]) -> None:
        await self._rpc_client.send(
            "context.add_cookies",
            ContextAddCookiesParams(cookies=list(cookies)),
            ContextVoidResult,
        )

    async def clear_cookies(
        self,
        *,
        name: str | re.Pattern[str] | None = None,
        domain: str | re.Pattern[str] | None = None,
        path: str | re.Pattern[str] | None = None,
    ) -> None:
        params = ContextClearCookiesParams()
        options = ClearCookieOptions.model_validate({
            field: _cookie_filter(value)
            for field, value in (("name", name), ("domain", domain), ("path", path))
            if value is not None
        })
        if options.model_fields_set:
            params.options = options
        await self._rpc_client.send(
            "context.clear_cookies",
            params,
            ContextVoidResult,
        )


def _cookie_filter(value: str | re.Pattern[str]) -> CookieFilter:
    if isinstance(value, str):
        return CookieFilter(root=value)
    flags = "".join(
        flag
        for enabled, flag in (
            (value.flags & re.IGNORECASE, "i"),
            (value.flags & re.MULTILINE, "m"),
            (value.flags & re.DOTALL, "s"),
        )
        if enabled
    )
    return CookieFilter(root=CookieRegex(source=value.pattern, flags=flags or None))
