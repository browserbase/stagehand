"""
Google Maps – Nearby Search
Search: "dealerships" near "urbana champaign"

Generated on: 2026-03-19T03:13:08.694Z
Recorded 10 browser interactions
Pure Playwright – no AI.
"""

import os
import sys
from dataclasses import dataclass
from typing import List
from playwright.sync_api import Playwright, sync_playwright


@dataclass(frozen=True)
class NearbySearchRequest:
    query: str
    location: str
    max_results: int = 5


@dataclass(frozen=True)
class BusinessDetail:
    name: str
    address: str
    rating: str
    phone: str
    website: str


@dataclass(frozen=True)
class NearbySearchResult:
    query: str
    location: str
    businesses: List[BusinessDetail]


# Search Google Maps for nearby businesses, click into each result card,
# and extract name, address, review score, phone, and website URL.
def search_nearby(playwright: Playwright, request: NearbySearchRequest) -> NearbySearchResult:
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
    businesses = []

    try:
        search_text = f"{request.query} near {request.location}"
        print(f"Loading Google Maps with query: {search_text} ...")
        encoded = search_text.replace(" ", "+")
        page.goto(f"https://www.google.com/maps/search/{encoded}/", wait_until="domcontentloaded", timeout=30000)

        # Wait for the results feed to appear (instead of fixed sleep)
        try:
            page.locator("[role='feed']").first.wait_for(state="attached", timeout=8000)
        except Exception:
            page.wait_for_timeout(2000)
        print(f"  Loaded: {page.url}")

        # Quick consent popup check (200ms timeout each – fast fail)
        for sel in ["button:has-text('Accept all')", "button:has-text('Reject all')",
                     "button:has-text('I agree')"]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=200):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(300)
            except Exception:
                pass

        # Click each card in the sidebar list, extract, then click the next card directly
        cards = page.locator("a[href*='/maps/place/']").all()
        seen_hrefs = set()
        unique_indices = []
        for idx, c in enumerate(cards):
            href = c.get_attribute("href") or ""
            if href and href not in seen_hrefs:
                seen_hrefs.add(href)
                unique_indices.append(idx)
        print(f"  Found {len(unique_indices)} result cards")

        for count, card_idx in enumerate(unique_indices[:request.max_results]):
            print(f"\n  --- Result {count+1} ---")

            # Re-query cards (indices stay the same, but DOM refs may go stale)
            cards = page.locator("a[href*='/maps/place/']").all()
            if card_idx >= len(cards):
                break

            cards[card_idx].evaluate("el => el.click()")
            try:
                page.locator("button[data-item-id='address']").first.wait_for(state='attached', timeout=3000)
            except Exception:
                page.wait_for_timeout(500)

            # Extract details
            detail = page.evaluate(r"""() => {
                const result = {name: 'N/A', address: 'N/A', rating: 'N/A', phone: 'N/A', website: 'N/A'};

                const headings = document.querySelectorAll('h1');
                for (const h of headings) {
                    const t = h.innerText.trim();
                    if (t && t !== 'Results' && t.length > 1) {
                        result.name = t;
                        break;
                    }
                }

                const stars = document.querySelectorAll("[role='img'][aria-label*='star']");
                for (const s of stars) {
                    const label = s.getAttribute('aria-label') || '';
                    const m = label.match(/([\d.]+)/);
                    if (m) { result.rating = m[1]; break; }
                }

                const addrEl = document.querySelector("button[data-item-id='address']");
                if (addrEl) {
                    const lines = addrEl.innerText.split('\n').map(l => l.trim()).filter(Boolean);
                    if (lines.length) result.address = lines[lines.length - 1];
                }

                const phoneEl = document.querySelector("button[data-item-id*='phone']");
                if (phoneEl) {
                    const t = phoneEl.innerText.trim();
                    const m = t.match(/[\(\d][\d\s\-\(\)\+]{6,}/);
                    if (m) result.phone = m[0].trim();
                }

                const siteEl = document.querySelector("a[data-item-id='authority']");
                if (siteEl) {
                    const href = siteEl.getAttribute('href') || '';
                    if (href && !href.includes('google.com')) result.website = href;
                    else { const t = siteEl.innerText.trim(); if (t && t.includes('.')) result.website = t; }
                }

                return result;
            }""")

            print(f"    Name:    {detail['name']}")
            print(f"    Address: {detail['address']}")
            print(f"    Rating:  {detail['rating']}")
            print(f"    Phone:   {detail['phone']}")
            print(f"    Website: {detail['website']}")

            businesses.append(BusinessDetail(
                name=detail["name"],
                address=detail["address"],
                rating=detail["rating"],
                phone=detail["phone"],
                website=detail["website"],
            ))

    except Exception as e:
        import traceback
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        try:
            context.close()
        except Exception:
            pass

    return NearbySearchResult(
        query=request.query,
        location=request.location,
        businesses=businesses,
    )


def test_search_nearby():
    request = NearbySearchRequest(
        query="dealerships",
        location="urbana champaign",
        max_results=5,
    )
    with sync_playwright() as pw:
        result = search_nearby(pw, request)

    print(f"\n{'='*60}")
    print(f"  Results: {len(result.businesses)} businesses")
    print(f"  Query: {result.query} near {result.location}")
    print(f"{'='*60}")
    for i, b in enumerate(result.businesses, 1):
        print(f"  {i}. {b.name}")
        print(f"     {b.address} | Rating: {b.rating} | {b.phone} | {b.website}")
    return result


if __name__ == "__main__":
    test_search_nearby()
