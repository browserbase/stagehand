"""
Ticketmaster – Concerts in Los Angeles
Generated: 2026-03-10T23:50:27.317Z
Pure Playwright – no AI.
"""
import re, os, traceback, sys, threading
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dataclasses import dataclass


@dataclass(frozen=True)
class TicketmasterSearchRequest:
    location: str = "Los Angeles"
    max_results: int = 5


@dataclass(frozen=True)
class TicketmasterEvent:
    name: str
    venue: str
    datetime: str
    price: str


@dataclass(frozen=True)
class TicketmasterSearchResult:
    location: str
    events: list


def search_ticketmaster_events(playwright, request: TicketmasterSearchRequest) -> TicketmasterSearchResult:
    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default"
    )
    context = playwright.chromium.launch_persistent_context(
        user_data_dir,
        channel="chrome",
        headless=False,
        viewport=None,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--disable-extensions",
        ],
    )
    page = context.pages[0] if context.pages else context.new_page()
    events = []

    def _watchdog():
        print("\n⏱️  WATCHDOG: 90s timeout — force exit")
        os._exit(1)

    timer = threading.Timer(90, _watchdog)
    timer.daemon = True
    timer.start()
    try:
        print("STEP 1: Navigate to Ticketmaster concert search...")
        loc_encoded = request.location.replace(" ", "+")
        page.goto(
            f"https://www.ticketmaster.com/search?q=concerts&loc={loc_encoded}&daterange=thisweekend",
            wait_until="domcontentloaded", timeout=30000,
        )
        page.wait_for_timeout(5000)

        for sel in ["button:has-text('Accept')", "button:has-text('Got It')", "#onetrust-accept-btn-handler"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        for _ in range(5):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)

        print("STEP 2: Extract event data...")

        events = page.evaluate(f"""((maxResults) => {{
            const results = [];
            const links = Array.from(document.querySelectorAll('[data-testid="event-list-link"]'));

            for (const el of links) {{
                if (results.length >= maxResults) break;

                // <li> is the natural boundary for one event card.
                const card = el.closest('li') || el;

                // ── Promoted filter ───────────────────────────────────────────────
                // Promoted badge is a visible leaf <span> in the card (not inside
                // the link or a button), containing exactly "Promoted".
                const hasPromoBadge = Array.from(card.querySelectorAll('span')).some(
                    s => !s.closest('a') && !s.closest('button') &&
                         s.children.length === 0 && /^Promoted$/i.test(s.textContent.trim())
                );
                if (hasPromoBadge) continue;

                // ── Name / City / Venue ───────────────────────────────────────────
                // The <button> ("Open additional information…") is the structural
                // anchor. DOM inspection shows name lives in the FIRST <span> sibling
                // AFTER the button, and city+venue in the SECOND <span> sibling.
                // This holds for both dated events (span before button = time display)
                // and undated events (span before button = "No date yet").
                const btn = card.querySelector('button');
                let nameEl = null, cvEl = null;
                if (btn) {{
                    let sib = btn.nextElementSibling;
                    while (sib && sib.tagName !== 'SPAN') sib = sib.nextElementSibling;
                    nameEl = sib;
                    sib = nameEl && nameEl.nextElementSibling;
                    while (sib && sib.tagName !== 'SPAN') sib = sib.nextElementSibling;
                    cvEl = sib;
                }}
                const nameLeaf = nameEl && nameEl.querySelector('span');
                const cvLeafs = cvEl ? Array.from(cvEl.querySelectorAll('span')).filter(
                    l => l.children.length === 0 && l.textContent.trim().length > 1
                ) : [];
                const name = nameLeaf ? nameLeaf.textContent.trim() : 'N/A';
                const city = cvLeafs[0] ? cvLeafs[0].textContent.trim() : '';
                const venueName = cvLeafs[1] ? cvLeafs[1].textContent.trim() : '';
                const venue = [city, venueName].filter(Boolean).join(' · ') || 'N/A';

                // ── Date ─────────────────────────────────────────────────────────
                // Prefer <time> (semantic HTML), then the long full-date span in
                // the date column (e.g. "August 2, 2026").
                let datetime = 'N/A';
                const timeEl = card.querySelector('time');
                if (timeEl) {{
                    datetime = timeEl.textContent.trim() || timeEl.getAttribute('datetime') || 'N/A';
                }} else {{
                    for (const span of card.querySelectorAll('span')) {{
                        const t = span.textContent.trim();
                        if (/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(t) && t.length < 60) {{
                            datetime = t;
                            break;
                        }}
                    }}
                }}

                if (name && name !== 'N/A') {{
                    results.push({{ name, venue, datetime, price: 'N/A' }});
                }}
            }}
            return results;
        }})({request.max_results})""")

        print(f"\nDONE – Top {len(events)} Events:")
        for i, e in enumerate(events, 1):
            print(f"  {i}. {e.get('name', 'N/A')}")
            print(f"     Venue: {e.get('venue', 'N/A')} | {e.get('datetime', 'N/A')} | {e.get('price', 'N/A')}")

    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        timer.cancel()
    return TicketmasterSearchResult(
        location=request.location,
        events=[TicketmasterEvent(
            name=e.get('name','N/A'), venue=e.get('venue','N/A'),
            datetime=e.get('datetime','N/A'), price=e.get('price','N/A'),
        ) for e in events],
    )


def test_ticketmaster_events():
    from playwright.sync_api import sync_playwright
    request = TicketmasterSearchRequest(location="Los Angeles", max_results=5)
    with sync_playwright() as pl:
        result = search_ticketmaster_events(pl, request)
        print(f"\nTotal events: {len(result.events)}")
        for i, e in enumerate(result.events, 1):
            print(f"  {i}. {e.name}  {e.venue}  {e.datetime}")
        os._exit(0)


if __name__ == "__main__":
    test_ticketmaster_events()