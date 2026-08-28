from __future__ import annotations

import asyncio
import os
import shutil
import signal
import socket
import sys
import tempfile
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal, Protocol

if TYPE_CHECKING:
    from .browser_context import BrowserContext

from ._generated.input_types import BrowserbaseBrowserSettings, ProxyConfig
from ._generated.models import (
    BrowserbaseRegion,
    BrowserbaseSessionCreateParams,
    BrowserSessionMetadata,
)
from .browserbase_session import DEFAULT_BROWSERBASE_URL, _create_browserbase_session_client
from .cdp_client import CDPClient, CDPConnectionClosedError
from .client_models import (
    BrowserbaseConnectOptions,
    LocalBrowserConnectOptions,
    LocalBrowserLaunchOptions,
    LocalProxyConfig,
    LocalViewport,
)
from .extension_assets import extension_directory
from .timeouts import stagehand_init_deadline

_WEBMCP_CHROME_FLAG = "--enable-features=WebMCPTesting,DevToolsWebMCPSupport"

_DEFAULT_CHROME_FLAGS = (
    "--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider,"
    "CalculateNativeWinOcclusion,InterestFeedContentSuggestions,"
    "CertificateTransparencyComponentUpdater,AutofillServerCommunication,"
    "PrivacySandboxSettings4,RenderDocument",
    "--disable-component-extensions-with-background-pages",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-client-side-phishing-detection",
    "--disable-sync",
    "--metrics-recording-only",
    "--disable-default-apps",
    "--mute-audio",
    "--no-default-browser-check",
    "--no-first-run",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
    "--disable-ipc-flooding-protection",
    "--password-store=basic",
    "--use-mock-keychain",
    "--force-fieldtrials=*BackgroundTracing/default/",
    "--disable-hang-monitor",
    "--disable-prompt-on-repost",
    "--disable-domain-reliability",
    "--propagate-iph-for-testing",
)

_BROWSER_TOKEN = object()


@dataclass(frozen=True)
class _WorkerInitMetadata:
    api_key: str | None
    browser: BrowserSessionMetadata | None


@dataclass(frozen=True)
class _ClaimedBrowser:
    cdp_client: CDPClient
    worker_init_metadata: _WorkerInitMetadata


@dataclass
class ResolvedBrowserSource:
    cdp_url: str
    keep_alive: bool
    _close_callback: Callable[[], Awaitable[None]] | None = field(default=None, repr=False)
    _closed: bool = field(default=False, init=False, repr=False)

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._close_callback is not None:
            await self._close_callback()


class StagehandBrowser:
    __slots__ = (
        "_attachment",
        "_claimed",
        "_close_callback",
        "_invalidate_callback",
        "_terminal_task",
        "_context",
        "_origin",
        "_provider",
        "_session_id",
    )

    def __init__(
        self,
        provider: Literal["local", "browserbase"],
        origin: Literal["launched", "connected"],
        attachment: _ClaimedBrowser,
        close: Callable[[], Awaitable[None]],
        *,
        invalidate: Callable[[], Awaitable[None]] | None = None,
        session_id: str | None = None,
        _token: object | None = None,
    ) -> None:
        if _token is not _BROWSER_TOKEN:
            raise TypeError("StagehandBrowser handles can only be created by browser factories")
        self._provider = provider
        self._origin = origin
        self._attachment = attachment
        self._close_callback = close
        self._invalidate_callback = invalidate or close
        self._claimed = False
        self._terminal_task: asyncio.Task[None] | None = None
        self._context: BrowserContext | None = None
        self._session_id = session_id

    @property
    def provider(self) -> Literal["local", "browserbase"]:
        return self._provider

    @property
    def origin(self) -> Literal["launched", "connected"]:
        return self._origin

    @property
    def session_id(self) -> str | None:
        """Browserbase session id backing this browser; None for local browsers."""
        return self._session_id

    @property
    def closed(self) -> bool:
        return self._terminal_task is not None

    @property
    def context(self) -> BrowserContext:
        if self._context is None:
            raise RuntimeError(
                "Browser context is unavailable. Attach the browser with "
                "await Stagehand.create(browser=browser)."
            )
        return self._context

    def close(self) -> Awaitable[None]:
        if self._terminal_task is None:
            self._terminal_task = asyncio.create_task(
                _run_browser_terminal_callback(self._close_callback),
                name="stagehand-browser-close",
            )
        return asyncio.shield(self._terminal_task)


def _claim_browser(browser: object) -> _ClaimedBrowser:
    if not isinstance(browser, StagehandBrowser):
        raise TypeError("browser must be created by local_browser or browserbase")
    if browser.closed:
        raise RuntimeError("Cannot attach Stagehand to a closed browser")
    if browser._claimed:
        raise RuntimeError("This browser is already attached to a Stagehand instance")
    browser._claimed = True
    return browser._attachment


def _release_browser(browser: StagehandBrowser) -> None:
    if not isinstance(browser, StagehandBrowser):
        raise TypeError("browser must be created by local_browser or browserbase")
    browser._claimed = False


def _invalidate_browser(browser: StagehandBrowser) -> Awaitable[None]:
    if not isinstance(browser, StagehandBrowser):
        raise TypeError("browser must be created by local_browser or browserbase")
    if browser._terminal_task is None:
        browser._terminal_task = asyncio.create_task(
            _run_browser_terminal_callback(browser._invalidate_callback),
            name="stagehand-browser-invalidate",
        )
    return asyncio.shield(browser._terminal_task)


async def _run_browser_terminal_callback(
    callback: Callable[[], Awaitable[None]],
) -> None:
    await callback()


def _attach_browser_context(
    browser: StagehandBrowser,
    context: BrowserContext,
) -> None:
    if not browser._claimed:
        raise RuntimeError("Cannot attach a browser context before Stagehand claims the browser")
    if browser._context is not None:
        raise RuntimeError("This browser already has a Stagehand context")
    browser._context = context


def _detach_browser_context(browser: StagehandBrowser) -> None:
    browser._context = None


def _browser_session_metadata(
    session_id: str,
    region: BrowserbaseRegion | None,
) -> BrowserSessionMetadata:
    # Leave region unset (not None) so the wire payload omits it entirely; the
    # worker schema rejects "region": null.
    return BrowserSessionMetadata.model_validate({
        name: value
        for name, value in (
            ("session_id", session_id),
            ("region", region),
        )
        if value is not None
    })


class _BrowserConnectionSource(Protocol):
    cdp_url: str
    keep_alive: bool

    async def close(self) -> None: ...


class _LocalBrowserOptions(Protocol):
    args: list[str] | None
    executable_path: str | None
    port: int | None
    user_data_dir: str | None
    preserve_user_data_dir: bool | None
    headless: bool | None
    devtools: bool | None
    chromium_sandbox: bool | None
    ignore_default_args: bool | list[str] | None
    proxy: LocalProxyConfig | None
    locale: str | None
    viewport: LocalViewport | None
    device_scale_factor: float | None
    has_touch: bool | None
    ignore_https_errors: bool | None
    downloads_path: str | None
    accept_downloads: bool | None
    keep_alive: bool | None


async def _connect_browser(
    *,
    provider: Literal["local", "browserbase"],
    origin: Literal["launched", "connected"],
    source: _BrowserConnectionSource,
    extension_dir: str | None = None,
    extension_id: str | None = None,
    preloaded_extension: bool = False,
    after_connect: Callable[[CDPClient], Awaitable[None]] | None = None,
    worker_init_metadata: _WorkerInitMetadata,
) -> StagehandBrowser:
    owns_source = origin == "launched" and not source.keep_alive
    cdp_client: CDPClient | None = None
    try:
        cdp_client = await CDPClient.connect(
            cdp_url=source.cdp_url,
            extension_dir=extension_dir,
            extension_id=extension_id,
            preloaded_extension=preloaded_extension,
            service_worker_url_includes="service-worker.js",
        )
        if after_connect is not None:
            await after_connect(cdp_client)
    except BaseException as error:
        cleanup_errors: list[BaseException] = []
        if cdp_client is not None:
            try:
                await cdp_client.close()
            except BaseException as cleanup_error:
                cleanup_errors.append(cleanup_error)
        if owns_source:
            try:
                await source.close()
            except BaseException as cleanup_error:
                cleanup_errors.append(cleanup_error)
        if not isinstance(error, Exception):
            raise
        for cleanup_error in cleanup_errors:
            if not isinstance(cleanup_error, Exception):
                raise cleanup_error
        if cleanup_errors:
            raise BaseExceptionGroup(
                "Browser connection failed and browser cleanup also failed",
                [error, *cleanup_errors],
            ) from error
        raise

    connected_client = cdp_client

    async def invalidate() -> None:
        try:
            await connected_client.close()
        finally:
            if owns_source:
                await source.close()

    async def close() -> None:
        errors: list[BaseException] = []
        try:
            if provider == "local" and origin == "connected":
                try:
                    await connected_client.send_command("Browser.close")
                except CDPConnectionClosedError:
                    pass
            else:
                await source.close()
        except BaseException as error:
            errors.append(error)
        try:
            await connected_client.close()
        except BaseException as error:
            errors.append(error)
        if len(errors) == 1:
            raise errors[0]
        if errors:
            raise BaseExceptionGroup("Browser termination and cleanup failed", errors)

    return StagehandBrowser(
        provider,
        origin,
        _ClaimedBrowser(
            cdp_client=connected_client,
            worker_init_metadata=worker_init_metadata,
        ),
        close,
        invalidate=invalidate,
        session_id=(
            worker_init_metadata.browser.session_id if worker_init_metadata.browser else None
        ),
        _token=_BROWSER_TOKEN,
    )


class LocalBrowser:
    @stagehand_init_deadline
    async def launch(
        self,
        *,
        args: Sequence[str] | None = None,
        executable_path: str | Path | None = None,
        port: int | None = None,
        user_data_dir: str | Path | None = None,
        preserve_user_data_dir: bool | None = None,
        headless: bool | None = None,
        devtools: bool | None = None,
        chromium_sandbox: bool | None = None,
        ignore_default_args: bool | Sequence[str] | None = None,
        proxy_server: str | None = None,
        proxy_bypass: str | None = None,
        proxy_username: str | None = None,
        proxy_password: str | None = None,
        locale: str | None = None,
        viewport_width: int | None = None,
        viewport_height: int | None = None,
        device_scale_factor: float | None = None,
        has_touch: bool | None = None,
        ignore_https_errors: bool | None = None,
        downloads_path: str | Path | None = None,
        accept_downloads: bool | None = None,
        keep_alive: bool | None = None,
    ) -> StagehandBrowser:
        if (viewport_width is None) != (viewport_height is None):
            raise TypeError("viewport_width and viewport_height must be provided together")
        if proxy_server is None and any(
            value is not None for value in (proxy_bypass, proxy_username, proxy_password)
        ):
            raise TypeError("proxy_server is required when configuring a local proxy")

        options = LocalBrowserLaunchOptions.model_validate({
            name: value
            for name, value in (
                (
                    "args",
                    list(args) if args is not None and not isinstance(args, str) else args,
                ),
                (
                    "executable_path",
                    str(executable_path) if executable_path is not None else None,
                ),
                ("port", port),
                ("user_data_dir", str(user_data_dir) if user_data_dir is not None else None),
                ("preserve_user_data_dir", preserve_user_data_dir),
                ("headless", headless),
                ("devtools", devtools),
                ("chromium_sandbox", chromium_sandbox),
                (
                    "ignore_default_args",
                    (
                        list(ignore_default_args)
                        if not isinstance(ignore_default_args, bool)
                        and ignore_default_args is not None
                        and not isinstance(ignore_default_args, str)
                        else ignore_default_args
                    ),
                ),
                (
                    "proxy",
                    (
                        LocalProxyConfig.model_validate(
                            {
                                name: value
                                for name, value in (
                                    ("server", proxy_server),
                                    ("bypass", proxy_bypass),
                                    ("username", proxy_username),
                                    ("password", proxy_password),
                                )
                                if value is not None
                            },
                            strict=True,
                        )
                        if proxy_server is not None
                        else None
                    ),
                ),
                ("locale", locale),
                (
                    "viewport",
                    (
                        LocalViewport.model_validate(
                            {"width": viewport_width, "height": viewport_height},
                            strict=True,
                        )
                        if viewport_width is not None and viewport_height is not None
                        else None
                    ),
                ),
                ("device_scale_factor", device_scale_factor),
                ("has_touch", has_touch),
                ("ignore_https_errors", ignore_https_errors),
                ("downloads_path", str(downloads_path) if downloads_path is not None else None),
                ("accept_downloads", accept_downloads),
                ("keep_alive", keep_alive),
            )
            if value is not None
        })
        if options.proxy is not None and (
            options.proxy.username is not None or options.proxy.password is not None
        ):
            raise NotImplementedError("Authenticated local browser proxies are not implemented yet")
        if options.accept_downloads is True and options.downloads_path is None:
            raise ValueError("downloads_path is required when accept_downloads is true")

        source = await _launch_local_browser(options)

        async def configure_downloads(cdp_client: CDPClient) -> None:
            params: dict[str, object] = {
                "behavior": "deny" if options.accept_downloads is False else "allow"
            }
            if options.downloads_path is not None:
                params["downloadPath"] = options.downloads_path
            await cdp_client.send_command("Browser.setDownloadBehavior", params)

        return await _connect_browser(
            provider="local",
            origin="launched",
            source=source,
            extension_dir=str(extension_directory()),
            after_connect=(
                configure_downloads
                if options.accept_downloads is not None or options.downloads_path is not None
                else None
            ),
            worker_init_metadata=_WorkerInitMetadata(api_key=None, browser=None),
        )

    @stagehand_init_deadline
    async def connect(
        self,
        *,
        cdp_url: str,
        extension_id: str | None = None,
    ) -> StagehandBrowser:
        options = LocalBrowserConnectOptions.model_validate({
            name: value
            for name, value in (
                ("cdp_url", cdp_url),
                ("extension_id", extension_id),
            )
            if value is not None
        })
        extension_dir = None if options.extension_id is not None else str(extension_directory())
        return await _connect_browser(
            provider="local",
            origin="connected",
            source=_ConnectedBrowserSource(options.cdp_url),
            extension_dir=extension_dir,
            extension_id=options.extension_id,
            worker_init_metadata=_WorkerInitMetadata(api_key=None, browser=None),
        )


@dataclass
class _ConnectedBrowserSource:
    cdp_url: str
    keep_alive: bool = True

    async def close(self) -> None:
        return None


class BrowserbaseBrowser:
    @stagehand_init_deadline
    async def launch(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BROWSERBASE_URL,
        browser_settings: BrowserbaseBrowserSettings | None = None,
        extension_id: str | None = None,
        keep_alive: bool | None = None,
        proxies: bool | list[ProxyConfig] | None = None,
        region: BrowserbaseRegion | None = None,
        timeout: float | None = None,
        user_metadata: Mapping[str, Any] | None = None,
    ) -> StagehandBrowser:
        if not api_key:
            raise ValueError("api_key must not be empty")
        if not base_url.strip():
            raise ValueError("base_url must not be empty")
        if extension_id is not None and not extension_id.strip():
            raise ValueError("extension_id must not be empty")
        options = BrowserbaseSessionCreateParams.model_validate({
            name: value
            for name, value in (
                ("browser_settings", browser_settings),
                ("extension_id", extension_id),
                ("keep_alive", keep_alive),
                ("proxies", proxies),
                ("region", region),
                ("timeout", timeout),
                ("user_metadata", dict(user_metadata) if user_metadata is not None else None),
            )
            if value is not None
        })
        if (
            options.browser_settings is not None
            and options.browser_settings.extension_id is not None
            and not options.browser_settings.extension_id.strip()
        ):
            raise ValueError("browser_settings.extension_id must not be empty")
        session = await _create_browserbase_session_client(api_key, base_url).create_session(
            options
        )
        source = ResolvedBrowserSource(
            cdp_url=session.cdp_url,
            keep_alive=options.keep_alive or False,
            _close_callback=session.close,
        )
        return await _connect_browser(
            provider="browserbase",
            origin="launched",
            source=source,
            preloaded_extension=True,
            worker_init_metadata=_WorkerInitMetadata(
                api_key=api_key,
                browser=_browser_session_metadata(session.session_id, options.region),
            ),
        )

    @stagehand_init_deadline
    async def connect(
        self,
        *,
        api_key: str,
        base_url: str = DEFAULT_BROWSERBASE_URL,
        session_id: str,
        extension_id: str | None = None,
    ) -> StagehandBrowser:
        options = BrowserbaseConnectOptions.model_validate({
            name: value
            for name, value in (
                ("api_key", api_key),
                ("base_url", base_url),
                ("session_id", session_id),
                ("extension_id", extension_id),
            )
            if value is not None
        })
        connection = await _create_browserbase_session_client(
            options.api_key, options.base_url
        ).connect_session(options.session_id)
        return await _connect_browser(
            provider="browserbase",
            origin="connected",
            source=ResolvedBrowserSource(
                cdp_url=connection.cdp_url,
                keep_alive=True,
                _close_callback=connection.close,
            ),
            extension_id=options.extension_id,
            preloaded_extension=options.extension_id is None,
            worker_init_metadata=_WorkerInitMetadata(
                api_key=options.api_key,
                browser=_browser_session_metadata(connection.session_id, connection.region),
            ),
        )


local_browser = LocalBrowser()
browserbase = BrowserbaseBrowser()


async def _launch_local_browser(options: _LocalBrowserOptions) -> ResolvedBrowserSource:
    chrome_path = options.executable_path or _find_chrome_path()
    port = options.port or _available_port()
    temporary_profile = options.user_data_dir is None
    user_data_dir = Path(options.user_data_dir or tempfile.mkdtemp(prefix="stagehand-chrome-"))
    flags = _local_browser_flags(
        options,
        port=port,
        user_data_dir=user_data_dir,
        is_ci=bool(os.environ.get("CI")),
    )
    try:
        process = await asyncio.create_subprocess_exec(
            chrome_path,
            *flags,
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=sys.platform != "win32",
        )
    except BaseException:
        if temporary_profile and options.preserve_user_data_dir is not True:
            await asyncio.to_thread(shutil.rmtree, user_data_dir, True)
        raise

    async def close() -> None:
        try:
            if process.returncode is None:
                try:
                    if sys.platform == "win32":
                        process.terminate()
                    else:
                        os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    await asyncio.wait_for(process.wait(), timeout=3)
                except TimeoutError:
                    try:
                        if sys.platform == "win32":
                            process.kill()
                        else:
                            os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    await process.wait()
        finally:
            if temporary_profile and options.preserve_user_data_dir is not True:
                await asyncio.to_thread(shutil.rmtree, user_data_dir, True)

    return ResolvedBrowserSource(
        cdp_url=f"http://127.0.0.1:{port}",
        keep_alive=options.keep_alive or False,
        _close_callback=close,
    )


def _local_browser_flags(
    options: _LocalBrowserOptions,
    *,
    port: int,
    user_data_dir: Path,
    is_ci: bool,
) -> list[str]:
    ignored_default_args = options.ignore_default_args
    ignored_flags = set(ignored_default_args) if isinstance(ignored_default_args, list) else set()
    include_defaults = ignored_default_args is not True
    stagehand_default_flags = (
        "--enable-unsafe-extension-debugging",
        "--remote-allow-origins=*",
    )
    viewport = (
        options.viewport if options.viewport is not None else LocalViewport(width=1280, height=800)
    )
    window_size_flag = f"--window-size={viewport.width},{viewport.height}"

    return [
        *(
            [flag for flag in _DEFAULT_CHROME_FLAGS if flag not in ignored_flags]
            if include_defaults
            else []
        ),
        *(
            [flag for flag in stagehand_default_flags if flag not in ignored_flags]
            if include_defaults
            else []
        ),
        *(
            [window_size_flag]
            if options.viewport is not None
            or (include_defaults and window_size_flag not in ignored_flags)
            else []
        ),
        *(
            [_WEBMCP_CHROME_FLAG]
            if include_defaults and _WEBMCP_CHROME_FLAG not in ignored_flags
            else []
        ),
        f"--remote-debugging-port={port}",
        f"--user-data-dir={user_data_dir}",
        *(["--headless"] if options.headless is True else []),
        *(["--auto-open-devtools-for-tabs"] if options.devtools is True else []),
        *(["--no-sandbox"] if is_ci or options.chromium_sandbox is False else []),
        *([f"--proxy-server={options.proxy.server}"] if options.proxy else []),
        *(
            [f"--proxy-bypass-list={options.proxy.bypass}"]
            if options.proxy and options.proxy.bypass
            else []
        ),
        *([f"--lang={options.locale}"] if options.locale else []),
        *(
            [f"--force-device-scale-factor={options.device_scale_factor}"]
            if options.device_scale_factor is not None
            else []
        ),
        *(["--touch-events=enabled"] if options.has_touch is True else []),
        *(["--ignore-certificate-errors"] if options.ignore_https_errors is True else []),
        *(options.args or []),
        "about:blank",
    ]


def _find_chrome_path() -> str:
    configured = os.environ.get("CHROME_PATH")
    if configured and Path(configured).is_file():
        return configured

    if sys.platform == "darwin":
        candidates = (
            "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        )
    elif sys.platform == "win32":
        roots = filter(
            None,
            (
                os.environ.get("LOCALAPPDATA"),
                os.environ.get("PROGRAMFILES"),
                os.environ.get("PROGRAMFILES(X86)"),
            ),
        )
        candidates = tuple(
            str(Path(root) / "Google" / "Chrome" / "Application" / "chrome.exe") for root in roots
        )
    else:
        candidates = tuple(
            path
            for name in (
                "google-chrome-stable",
                "google-chrome",
                "chromium-browser",
                "chromium",
            )
            if (path := shutil.which(name)) is not None
        )

    for candidate in candidates:
        if Path(candidate).is_file():
            return candidate
    raise RuntimeError("Chrome installation not found; set CHROME_PATH")


def _available_port() -> int:
    with socket.socket() as candidate:
        candidate.bind(("127.0.0.1", 0))
        return int(candidate.getsockname()[1])
