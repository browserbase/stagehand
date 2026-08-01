from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field

from . import browser as _browser
from .client_models import LocalBrowserSource, StagehandClientInitParams

_DEFAULT_CHROME_FLAGS = _browser._DEFAULT_CHROME_FLAGS
_WEBMCP_CHROME_FLAG = _browser._WEBMCP_CHROME_FLAG
_available_port = _browser._available_port
_find_chrome_path = _browser._find_chrome_path
_launch_local_browser_impl = _browser._launch_local_browser
_local_browser_flags = _browser._local_browser_flags


@dataclass
class ResolvedBrowserSource:
    cdp_url: str
    keep_alive: bool
    resident_browser_connection: bool = False
    cdp_headers: dict[str, str] | None = None
    connect_timeout_ms: int | None = None
    _close_callback: Callable[[], Awaitable[None]] | None = field(default=None, repr=False)
    _closed: bool = field(default=False, init=False, repr=False)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._close_callback is not None:
            await self._close_callback()


async def resolve_browser_source(
    init_params: StagehandClientInitParams,
) -> ResolvedBrowserSource:
    browser = init_params.browser

    if browser.type == "browserbase":
        raise NotImplementedError("Browserbase session creation is not implemented yet")

    if browser.type == "local":
        return await _launch_local_browser(browser)

    if browser.headers is not None:
        raise NotImplementedError("CDP headers are not implemented yet")
    return ResolvedBrowserSource(cdp_url=browser.cdp_url, keep_alive=True)


async def _launch_local_browser(options: LocalBrowserSource) -> ResolvedBrowserSource:
    if options.proxy is not None and (
        options.proxy.username is not None or options.proxy.password is not None
    ):
        raise NotImplementedError("Authenticated local browser proxies are not implemented yet")
    if options.downloads_path is not None or options.accept_downloads is not None:
        raise NotImplementedError("Local browser download options are not implemented yet")

    return await _launch_local_browser_impl(options)
