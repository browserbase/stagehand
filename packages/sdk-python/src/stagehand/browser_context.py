from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import TypedDict

from ._generated.input_types import CookieParam
from ._generated.input_types import DomainPolicy as DomainPolicyInput
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
    CookieRegex,
    DomainPolicy,
    EmptyParams,
    PageRef,
    SameSite,
)
from .browser_clipboard import BrowserClipboard
from .page import Page
from .rpc_client import RPCClient


class StorageStateLocalStorageItem(TypedDict):
    name: str
    value: str


class StorageStateOrigin(TypedDict):
    origin: str
    localStorage: list[StorageStateLocalStorageItem]


class StorageState(TypedDict):
    """Playwright-compatible storage state. ``origins`` is always empty on export today."""

    cookies: list[Cookie]
    origins: list[StorageStateOrigin]


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
        return [Page(self._rpc_client, page_ref) for page_ref in result]

    async def new_page(self, url: str | None = None) -> Page:
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
        return None if result is None else Page(self._rpc_client, result)

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
        return await self._rpc_client.send(
            "context.get_domain_policy",
            EmptyParams(),
            ContextGetDomainPolicyResult,
        )

    async def set_domain_policy(
        self,
        policy: DomainPolicyInput | DomainPolicy | None,
    ) -> None:
        await self._rpc_client.send(
            "context.set_domain_policy",
            ContextSetDomainPolicyParams.model_validate({"policy": policy}),
            ContextVoidResult,
        )

    async def cookies(self, urls: str | Sequence[str] | None = None) -> list[Cookie]:
        params = ContextCookiesParams()
        if urls is not None:
            params.urls = list(urls) if not isinstance(urls, str) else urls
        return await self._rpc_client.send(
            "context.cookies",
            params,
            ContextCookiesResult,
        )

    async def add_cookies(self, cookies: Sequence[CookieParam]) -> None:
        await self._rpc_client.send(
            "context.add_cookies",
            ContextAddCookiesParams.model_validate({"cookies": list(cookies)}),
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

    async def storage_state(self, *, path: str | Path | None = None) -> StorageState:
        """Export cookies in a Playwright-compatible storage state shape.

        localStorage / IndexedDB are not included yet (``origins`` is always ``[]``).
        """
        cookies = await self.cookies()
        state: StorageState = {"cookies": cookies, "origins": []}
        if path is not None:
            Path(path).write_text(
                json.dumps(_storage_state_to_json(state), indent=2) + "\n",
                encoding="utf-8",
            )
        return state

    async def set_storage_state(self, state: StorageState | str | Path | Mapping[str, object]) -> None:
        """Replace cookies from a storage state object or JSON file.

        Clears existing cookies first. ``origins`` / localStorage entries are ignored for now.
        """
        resolved = (
            _load_storage_state_file(Path(state))
            if isinstance(state, (str, Path))
            else _normalize_storage_state(state)
        )
        cookies = [_cookie_to_param(cookie) for cookie in resolved["cookies"]]
        await self.clear_cookies()
        if not cookies:
            return
        await self.add_cookies(cookies)


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


def _cookie_to_param(cookie: Cookie) -> CookieParam:
    return {
        "name": cookie.name,
        "value": cookie.value,
        "domain": cookie.domain,
        "path": cookie.path,
        "expires": cookie.expires,
        "http_only": cookie.http_only,
        "secure": cookie.secure,
        "same_site": (
            cookie.same_site.value
            if isinstance(cookie.same_site, SameSite)
            else cookie.same_site
        ),
    }


def _storage_state_to_json(state: StorageState) -> dict[str, object]:
    return {
        "cookies": [
            {
                "name": cookie.name,
                "value": cookie.value,
                "domain": cookie.domain,
                "path": cookie.path,
                "expires": cookie.expires,
                "httpOnly": cookie.http_only,
                "secure": cookie.secure,
                "sameSite": (
                    cookie.same_site.value
                    if isinstance(cookie.same_site, SameSite)
                    else cookie.same_site
                ),
            }
            for cookie in state["cookies"]
        ],
        "origins": list(state["origins"]),
    }


def _load_storage_state_file(path: Path) -> StorageState:
    try:
        parsed = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise TypeError(f"set_storage_state(): failed to parse JSON from {path}: {error}") from error
    return _normalize_storage_state(parsed)


def _normalize_storage_state(value: object) -> StorageState:
    if not isinstance(value, Mapping):
        raise TypeError("storage state must be an object with a cookies array")
    cookies_value = value.get("cookies")
    if not isinstance(cookies_value, list):
        raise TypeError("storage state must include a cookies array")
    cookies = [_normalize_storage_cookie(entry, index) for index, entry in enumerate(cookies_value)]
    origins_value = value.get("origins", [])
    if origins_value is None:
        origins_value = []
    if not isinstance(origins_value, list):
        raise TypeError("storage state origins must be an array when provided")
    origins = [_normalize_storage_origin(entry, index) for index, entry in enumerate(origins_value)]
    return {"cookies": cookies, "origins": origins}


def _normalize_storage_cookie(value: object, index: int) -> Cookie:
    if not isinstance(value, Mapping):
        raise TypeError(f"storage state cookies[{index}] must be an object")
    same_site = value.get("sameSite", value.get("same_site"))
    http_only = value.get("httpOnly", value.get("http_only"))
    try:
        return Cookie.model_validate({
            "name": value["name"],
            "value": value["value"],
            "domain": value["domain"],
            "path": value["path"],
            "expires": value["expires"],
            "http_only": http_only,
            "secure": value["secure"],
            "same_site": same_site,
        })
    except (KeyError, TypeError, ValueError) as error:
        raise TypeError(f"storage state cookies[{index}] has an invalid shape") from error


def _normalize_storage_origin(value: object, index: int) -> StorageStateOrigin:
    if not isinstance(value, Mapping):
        raise TypeError(f"storage state origins[{index}] must be an object")
    origin = value.get("origin")
    local_storage = value.get("localStorage")
    if not isinstance(origin, str) or not isinstance(local_storage, list):
        raise TypeError(f"storage state origins[{index}] has an invalid shape")
    items: list[StorageStateLocalStorageItem] = []
    for entry_index, entry in enumerate(local_storage):
        if not isinstance(entry, Mapping):
            raise TypeError(
                f"storage state origins[{index}].localStorage[{entry_index}] must be an object"
            )
        name = entry.get("name")
        item_value = entry.get("value")
        if not isinstance(name, str) or not isinstance(item_value, str):
            raise TypeError(
                f"storage state origins[{index}].localStorage[{entry_index}] has an invalid shape"
            )
        items.append({"name": name, "value": item_value})
    return {"origin": origin, "localStorage": items}
