#!/usr/bin/env python3
"""
Home Depot cordless drill search – pure Playwright CDP extraction.

Strategy:  Launch Chrome *with the URL on the command line* so the page loads
natively (no automation framework driving navigation).  This lets Akamai /
PerimeterX bot-manager challenges pass.  After the page settles, Playwright
connects via CDP *only* for DOM extraction.

Selectors (verified via live DOM inspection):
    product pod     [data-testid="product-pod"]  (24 items – desktop + mobile)
    name            [data-testid="attribute-product-label"]
    header (brand)  [data-testid="product-header"]
    price           [data-testid="price-simple"]   → regex \\$[\\d,]+(?:\\.\\d{2})?
    rating          [data-testid="product-pod__ratings-link"] → regex \\((\\d+(?:\\.\\d+)?)\\s*/
"""

import json, os, re, shutil, subprocess, sys, tempfile, time
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import find_chrome_executable, get_free_port

QUERY = "cordless drill"
MAX   = 5
URL   = "https://www.homedepot.com/s/cordless%20drill?NCNI-5&sortby=toprated"

# ── helpers ──────────────────────────────────────────────

def _launch_chrome_with_url(url: str, port: int, profile_dir: str) -> subprocess.Popen:
    """Launch real Chrome opening *url* directly — minimal flags so bot
    manager JS challenges pass before any automation framework connects."""
    chrome = os.environ.get("CHROME_PATH") or find_chrome_executable()
    return subprocess.Popen(
        [
            chrome,
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile_dir}",
            "--remote-allow-origins=*",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-blink-features=AutomationControlled",
            "--window-size=1280,987",
            url,  # ← open the target page immediately
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _wait_cdp(port: int, timeout_s: float = 20.0) -> str:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            resp = urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2)
            ws = json.loads(resp.read()).get("webSocketDebuggerUrl", "")
            if ws:
                return ws
        except Exception:
            pass
        time.sleep(0.5)
    raise TimeoutError(f"Chrome CDP not ready on port {port}")


def _extract_products(page, max_results: int) -> list[dict]:
    """Extract products from the live DOM using data-testid selectors."""
    return page.evaluate(r"""(maxResults) => {
        const pods = document.querySelectorAll('[data-testid="product-pod"]');
        const seen = new Set();
        const results = [];
        for (const pod of pods) {
            if (results.length >= maxResults) break;

            /* ── name ── */
            const nameEl = pod.querySelector('[data-testid="attribute-product-label"]');
            let name = nameEl ? nameEl.textContent.trim() : '';
            if (!name) continue;

            /* ── dedup (desktop + mobile duplicates) ── */
            const key = name.replace(/\s+/g, ' ').toLowerCase();
            if (seen.has(key)) continue;
            seen.add(key);

            /* ── brand from header (header = brand + name concatenated) ── */
            const hdrEl = pod.querySelector('[data-testid="product-header"]');
            if (hdrEl) {
                const full = hdrEl.textContent.trim();
                if (full.length > name.length && full.endsWith(name)) {
                    const brand = full.slice(0, full.length - name.length).trim();
                    if (brand) name = brand + ' ' + name;
                }
            }

            /* ── price ── */
            const priceEl = pod.querySelector('[data-testid="price-simple"]');
            let price = 'N/A';
            if (priceEl) {
                const m = priceEl.textContent.match(/\$[\d,]+(?:\.\d{2})?/);
                if (m) price = m[0];
            }

            /* ── rating ── */
            const ratingEl = pod.querySelector('[data-testid="product-pod__ratings-link"]');
            let rating = 'N/A';
            if (ratingEl) {
                const m = ratingEl.textContent.match(/\((\d+(?:\.\d+)?)\s*\//);
                if (m) rating = m[1];
            }

            results.push({ name, price, rating });
        }
        return results;
    }""", max_results)


def dismiss(page):
    for sel in [
        "#onetrust-accept-btn-handler",
        "button:has-text('Accept All')",
        "button:has-text('Got it')",
        "button:has-text('No Thanks')",
    ]:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=600):
                loc.evaluate("el => el.click()")
                time.sleep(0.3)
        except Exception:
            pass


# ── main ─────────────────────────────────────────────────

def main():
    port = get_free_port()
    profile_dir = tempfile.mkdtemp(prefix="homedepot_chrome_")
    chrome_proc = _launch_chrome_with_url(URL, port, profile_dir)

    try:
        # Let Chrome load the page and pass bot-manager challenges *before*
        # any automation framework connects.
        print("Waiting for page to load natively (20 s) …")
        time.sleep(20)

        ws_url = _wait_cdp(port)
        print("Connecting Playwright for extraction …")

        with sync_playwright() as pw:
            browser = pw.chromium.connect_over_cdp(ws_url)
            context = browser.contexts[0]

            # Find the Home Depot page
            page = None
            for p in context.pages:
                if "homedepot" in p.url:
                    page = p
                    break
            if not page:
                print("ERROR: Home Depot page not found among open pages.")
                for p in context.pages:
                    print(f"  → {p.url[:80]}")
                return

            print(f"Page URL: {page.url[:100]}")
            dismiss(page)

            # Check for error page
            snippet = page.evaluate("document.body.innerText.substring(0, 300)")
            if "Something went wrong" in snippet or "Oops" in snippet:
                print("ERROR: Home Depot returned error page.")
                print(f"  body: {snippet[:200]}")
                return

            products = _extract_products(page, MAX)
            browser.close()

        # ── display ──
        print()
        print("=" * 60)
        print(f"  Home Depot – Top {MAX} '{QUERY}' (Top Rated)")
        print("=" * 60)
        for idx, p in enumerate(products, 1):
            print(f"  {idx}. {p['name']}")
            print(f"     Price:  {p['price']}")
            print(f"     Rating: {p['rating']}")
            print()

        if not products:
            print("  ⚠ No products extracted from live page.")

    finally:
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
