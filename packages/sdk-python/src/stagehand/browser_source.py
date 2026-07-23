from __future__ import annotations

import asyncio
import os
import shutil
import signal
import socket
import sys
import tempfile
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path

from .client_models import LocalBrowserSource, StagehandClientInitParams

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


@dataclass
class ResolvedBrowserSource:
    cdp_url: str
    keep_alive: bool
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

    chrome_path = options.executable_path or _find_chrome_path()
    port = options.port or _available_port()
    temporary_profile = options.user_data_dir is None
    user_data_dir = Path(options.user_data_dir or tempfile.mkdtemp(prefix="stagehand-chrome-"))
    if options.ignore_default_args is True:
        default_flags: list[str] = []
    elif isinstance(options.ignore_default_args, list):
        ignored = set(options.ignore_default_args)
        default_flags = [flag for flag in _DEFAULT_CHROME_FLAGS if flag not in ignored]
    else:
        default_flags = list(_DEFAULT_CHROME_FLAGS)

    window_size = options.viewport
    flags = [
        *default_flags,
        "--enable-unsafe-extension-debugging",
        "--remote-allow-origins=*",
        (
            f"--window-size={window_size.width},{window_size.height}"
            if window_size is not None
            else "--window-size=1280,800"
        ),
        f"--remote-debugging-port={port}",
        f"--user-data-dir={user_data_dir}",
        *(options.args or []),
        *(["--headless"] if options.headless is True else []),
        *(["--auto-open-devtools-for-tabs"] if options.devtools is True else []),
        *(["--no-sandbox"] if os.environ.get("CI") or options.chromium_sandbox is False else []),
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
        "about:blank",
    ]
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
        if process.returncode is None:
            if sys.platform == "win32":
                process.terminate()
            else:
                os.killpg(process.pid, signal.SIGTERM)
            try:
                await asyncio.wait_for(process.wait(), timeout=3)
            except TimeoutError:
                if sys.platform == "win32":
                    process.kill()
                else:
                    os.killpg(process.pid, signal.SIGKILL)
                await process.wait()
        if temporary_profile and options.preserve_user_data_dir is not True:
            await asyncio.to_thread(shutil.rmtree, user_data_dir, True)

    return ResolvedBrowserSource(
        cdp_url=f"http://127.0.0.1:{port}",
        keep_alive=options.keep_alive or False,
        connect_timeout_ms=options.connect_timeout_ms,
        _close_callback=close,
    )


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
