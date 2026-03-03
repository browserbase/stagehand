"""
Shared Chrome DevTools Protocol (CDP) utilities for launching real Chrome
and connecting Playwright as a passive debugger — avoids anti-bot detection.

Mirrors how Stagehand's chrome-launcher spawns Chrome:
  - Raw subprocess.Popen with the same default flags
  - No navigator.webdriver=true
  - No Playwright automation markers

Usage in site scripts:
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

    port = get_free_port()
    profile_dir = get_temp_profile_dir("site_name")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    ...
    browser.close()
    chrome_proc.terminate()
    shutil.rmtree(profile_dir, ignore_errors=True)
"""

import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
from urllib.request import urlopen


def find_chrome_executable() -> str:
    """Find real Chrome executable on Windows."""
    candidates = []
    for env_var in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"]:
        base = os.environ.get(env_var, "")
        if base:
            candidates.append(
                os.path.join(base, "Google", "Chrome", "Application", "chrome.exe")
            )
    # Also check Canary
    local = os.environ.get("LOCALAPPDATA", "")
    if local:
        candidates.append(
            os.path.join(local, "Google", "Chrome SxS", "Application", "chrome.exe")
        )
    for c in candidates:
        if os.path.isfile(c):
            return c
    raise FileNotFoundError(
        "Could not find Chrome. Install Google Chrome or set CHROME_PATH env var."
    )


def get_free_port() -> int:
    """Get a random free TCP port."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get_temp_profile_dir(site: str = "default") -> str:
    """Create a temp Chrome profile dir, copying prefs from real profile."""
    tmp = os.path.join(
        tempfile.gettempdir(), f"{site}_chrome_profile_{os.getpid()}"
    )
    os.makedirs(tmp, exist_ok=True)
    src = os.path.join(
        os.environ.get("LOCALAPPDATA", ""),
        "Google", "Chrome", "User Data", "Default",
    )
    for f in ["Preferences", "Local State"]:
        s = os.path.join(src, f)
        if os.path.exists(s):
            try:
                shutil.copy2(s, os.path.join(tmp, f))
            except (PermissionError, OSError):
                pass
    return tmp


def launch_chrome(
    profile_dir: str, port: int, headless: bool = False
) -> subprocess.Popen:
    """
    Launch real Chrome with the same flags Stagehand uses (chrome-launcher defaults).
    No Playwright — just a raw Chrome process with remote debugging enabled.
    """
    chrome_path = os.environ.get("CHROME_PATH") or find_chrome_executable()
    flags = [
        chrome_path,
        f"--remote-debugging-port={port}",
        f"--user-data-dir={profile_dir}",
        "--remote-allow-origins=*",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-dev-shm-usage",
        "--site-per-process",
        # Anti-detection: matches Stagehand behavior
        "--disable-blink-features=AutomationControlled",
        # Chrome-launcher defaults for stability
        "--disable-extensions",
        "--disable-component-extensions-with-background-pages",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-client-side-phishing-detection",
        "--disable-sync",
        "--metrics-recording-only",
        "--disable-default-apps",
        "--mute-audio",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-background-timer-throttling",
        "--disable-ipc-flooding-protection",
        "--password-store=basic",
        "--force-fieldtrials=*BackgroundTracing/default/",
        "--disable-hang-monitor",
        "--disable-prompt-on-repost",
        "--disable-domain-reliability",
        "--disable-infobars",
        "--window-size=1280,987",
        "about:blank",
    ]
    if headless:
        flags.insert(1, "--headless=new")

    return subprocess.Popen(
        flags, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )


def wait_for_cdp_ws(port: int, timeout_s: float = 15.0) -> str:
    """Poll http://127.0.0.1:PORT/json/version until the WebSocket URL appears."""
    deadline = time.time() + timeout_s
    last_err = ""
    while time.time() < deadline:
        try:
            resp = urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2)
            data = json.loads(resp.read())
            ws_url = data.get("webSocketDebuggerUrl", "")
            if ws_url:
                return ws_url
        except Exception as e:
            last_err = str(e)
        time.sleep(0.25)
    raise TimeoutError(
        f"Timed out waiting for Chrome CDP on port {port}: {last_err}"
    )


def cdp_cleanup(browser, chrome_proc, profile_dir):
    """Clean up CDP resources: close browser, terminate Chrome, remove temp profile."""
    try:
        browser.close()
    except Exception:
        pass
    try:
        chrome_proc.terminate()
        chrome_proc.wait(timeout=5)
    except Exception:
        pass
    try:
        shutil.rmtree(profile_dir, ignore_errors=True)
    except Exception:
        pass
