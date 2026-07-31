from __future__ import annotations

import asyncio
import os
import shutil
import signal
import socket
import sys
import tempfile
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath, PureWindowsPath

from .client_models import LocalBrowserSource, StagehandClientInitParams

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

_MAC_APPLICATIONS = (
    ("Google Chrome.app", "Google Chrome"),
    ("Google Chrome Beta.app", "Google Chrome Beta"),
    ("Google Chrome Dev.app", "Google Chrome Dev"),
    ("Google Chrome Canary.app", "Google Chrome Canary"),
    ("Chromium.app", "Chromium"),
)

_WINDOWS_APPLICATIONS = (
    ("Google", "Chrome"),
    ("Google", "Chrome Beta"),
    ("Google", "Chrome Dev"),
    ("Google", "Chrome SxS"),
    ("Chromium",),
)

_LINUX_EXECUTABLES = (
    "google-chrome-stable",
    "google-chrome",
    "google-chrome-beta",
    "google-chrome-unstable",
    "chromium-browser",
    "chromium",
)

_CHROME_NOT_FOUND_MESSAGE = (
    "No supported local browser installation was found. Stagehand supports Chrome Stable, "
    "Beta, Dev, Canary, and Chromium. Set browser.executable_path or CHROME_PATH to use a "
    "custom executable."
)


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
        resident_browser_connection=False,
        connect_timeout_ms=options.connect_timeout_ms,
        _close_callback=close,
    )


def _chrome_file_candidates(
    platform: str,
    environ: Mapping[str, str],
    home_directory: str,
) -> tuple[str, ...]:
    if platform == "darwin":
        application_directories = (
            PurePosixPath("/Applications"),
            PurePosixPath(home_directory) / "Applications",
        )
        return tuple(
            str(directory / bundle / "Contents" / "MacOS" / executable)
            for bundle, executable in _MAC_APPLICATIONS
            for directory in application_directories
        )

    if platform == "win32":
        roots = tuple(
            root
            for key in ("LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)")
            if (root := environ.get(key))
        )
        return tuple(
            str(PureWindowsPath(root, *segments, "Application", "chrome.exe"))
            for segments in _WINDOWS_APPLICATIONS
            for root in roots
        )

    return ()


def _find_chrome_path(
    *,
    platform: str | None = None,
    environ: Mapping[str, str] | None = None,
    home_directory: str | None = None,
    is_file: Callable[[str], bool] | None = None,
    which: Callable[[str], str | None] | None = None,
) -> str:
    current_platform = platform or sys.platform
    current_environ = os.environ if environ is None else environ
    current_home = str(Path.home()) if home_directory is None else home_directory
    file_exists = (lambda candidate: Path(candidate).is_file()) if is_file is None else is_file
    find_on_path = (
        (lambda name: shutil.which(name, path=current_environ.get("PATH", "")))
        if which is None
        else which
    )

    configured = current_environ.get("CHROME_PATH")
    if configured and file_exists(configured):
        return configured

    for candidate in _chrome_file_candidates(current_platform, current_environ, current_home):
        if file_exists(candidate):
            return candidate

    if current_platform not in ("darwin", "win32"):
        for executable in _LINUX_EXECUTABLES:
            if candidate := find_on_path(executable):
                return candidate

    raise RuntimeError(_CHROME_NOT_FOUND_MESSAGE)

def _local_browser_flags(
    options: LocalBrowserSource,
    *,
    port: int,
    user_data_dir: Path,
    is_ci: bool,
) -> list[str]:
    ignored_default_args = options.ignore_default_args
    ignored_flags = set(ignored_default_args) if isinstance(ignored_default_args, list) else set()
    include_defaults = ignored_default_args is not True
    window_size = options.viewport
    stagehand_default_flags = (
        "--enable-unsafe-extension-debugging",
        "--remote-allow-origins=*",
        (
            f"--window-size={window_size.width},{window_size.height}"
            if window_size is not None
            else "--window-size=1280,800"
        ),
        _WEBMCP_CHROME_FLAG,
    )

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


def _available_port() -> int:
    with socket.socket() as candidate:
        candidate.bind(("127.0.0.1", 0))
        return int(candidate.getsockname()[1])
