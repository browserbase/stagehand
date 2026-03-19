"""
Trulia rental search automation using Playwright
Searches for rental properties with configurable location and bedroom requirements.
Pure Playwright – no AI.
"""
import re, os, sys, traceback, shutil, tempfile, threading
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dataclasses import dataclass




@dataclass(frozen=True)
class TruliaSearchRequest:
    location: str
    min_beds: int = 0
    max_results: int = 5


@dataclass(frozen=True)
class TruliaListing:
    address: str
    rent: str
    beds: str
    baths: str


@dataclass(frozen=True)
class TruliaSearchResult:
    location: str
    listings: list


def search_trulia_homes(playwright, request: TruliaSearchRequest) -> TruliaSearchResult:
    # Use real Chrome profile to avoid bot detection (same as open_browser.py)
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
    listings = []

    # Watchdog: force-close after 90 seconds so the script never hangs VS Code
    def _watchdog():
        print("\n⏱️  WATCHDOG: 90s timeout reached — closing browser...")
        try:
            context.close()
        except Exception:
            pass
        os._exit(1)

    timer = threading.Timer(90, _watchdog)
    timer.daemon = True
    timer.start()
    try:
        print("STEP 1: Navigate to Trulia homepage...")
        page.goto("https://www.trulia.com/", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)
        
        print("STEP 2: Dismiss any popups/banners...")
        for sel in ["button:has-text('Accept')", "#onetrust-accept-btn-handler",
                     "button:has-text('Accept All')", "button:has-text('Got It')",
                     "button:has-text('No Thanks')", "[aria-label='Close']",
                     "button:has-text('Continue')", "button:has-text('OK')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.click()
                    print(f"   Dismissed: {sel}")
                    page.wait_for_timeout(500)
            except Exception:
                pass
        
        print("STEP 3: Click 'rent' tab...")
        # Try multiple selectors for the rent tab/button
        rent_clicked = False
        rent_selectors = [
            "button:has-text('Rent')",
            "a:has-text('Rent')", 
            "[data-testid*='rent']",
            "[href*='rent']",
            "nav a:has-text('Rent')",
            ".nav a:has-text('Rent')"
        ]
        
        for selector in rent_selectors:
            try:
                element = page.locator(selector).first
                if element.is_visible(timeout=2000):
                    element.click()
                    rent_clicked = True
                    print(f"   Clicked rent tab using selector: {selector}")
                    break
            except Exception:
                continue
        
        if not rent_clicked:
            print("   Warning: Could not find rent tab, continuing...")
        
        page.wait_for_timeout(2000)
        
        print(f"STEP 3: Enter location '{request.location}' in search box...")
        # Try multiple selectors for search input
        search_input = None
        search_selectors = [
            "input[placeholder*='neighborhood']",
            "input[placeholder*='city']", 
            "input[placeholder*='location']",
            "input[name*='location']",
            "input[type='text']",
            ".search-input input",
            "[data-testid*='search'] input"
        ]
        
        for selector in search_selectors:
            try:
                element = page.locator(selector).first
                if element.is_visible(timeout=2000):
                    search_input = element
                    print(f"   Found search input using selector: {selector}")
                    break
            except Exception:
                continue
        
        if search_input:
            # Step A: Focus and fully clear the input using keyboard (not .clear())
            # .clear() doesn't fire input/change events that Trulia's React needs
            search_input.click()
            page.wait_for_timeout(500)
            
            # Select all + delete to trigger proper React events
            page.keyboard.press("Control+a")
            page.wait_for_timeout(100)
            page.keyboard.press("Backspace")
            page.wait_for_timeout(500)
            
            # Step B: Type using keyboard (not .type() on element) to fire native events
            print(f"   Typing '{request.location}' via keyboard...")
            page.keyboard.type(request.location, delay=100)
            print(f"   Typed '{request.location}' into search input")
            
            # Step C: Wait for autocomplete dropdown to appear
            print("   Waiting for autocomplete suggestions...")
            page.wait_for_timeout(3000)
            
            # Debug: dump all visible elements near the input
            for dbg_sel in ["[data-testid*='suggestion']", "[role='listbox']",
                            "[role='option']", "ul[class*='auto']", "ul[class*='Auto']",
                            "ul[class*='suggest']", "ul[class*='Suggest']",
                            "li[data-testid]"]:
                try:
                    c = page.locator(dbg_sel).count()
                    if c > 0:
                        vis = page.locator(f"{dbg_sel}:visible").count()
                        print(f"   DEBUG dropdown: {dbg_sel} → {c} total, {vis} visible")
                except Exception:
                    pass
            
            # Step D: Try to find and click an autocomplete suggestion
            suggestion_clicked = False
            suggestion_selectors = [
                "[data-testid*='suggestion']",
                "[data-testid*='autocomplete'] li",
                "[role='option']",
                "[role='listbox'] li",
                "[role='listbox'] [role='option']",
                "ul[role='listbox'] li",
                "[class*='autocomplete'] li",
                "[class*='suggestion']",
                "[class*='Suggestion']",
                "[class*='dropdown'] li",
                "[class*='Dropdown'] li",
                "[id*='suggestion']",
                "[id*='autocomplete'] li",
            ]
            
            # Parse location into city and state for matching
            loc_parts = [p.strip().lower() for p in request.location.split(",")]
            city_name = loc_parts[0] if loc_parts else request.location.lower()
            state_abbr = loc_parts[1].strip() if len(loc_parts) > 1 else ""
            
            for selector in suggestion_selectors:
                try:
                    suggestions = page.locator(selector)
                    count = suggestions.count()
                    if count > 0 and suggestions.first.is_visible(timeout=1000):
                        print(f"   Found {count} suggestions using: {selector}")
                        
                        # Log all suggestions and find best match
                        best_match = None
                        best_score = -1
                        
                        for idx in range(min(count, 10)):
                            try:
                                item = suggestions.nth(idx)
                                text = (item.text_content() or "").strip()
                                print(f"      [{idx}] '{text[:80]}'")
                                
                                text_lower = text.lower()
                                score = 0
                                
                                # Exact city+state match (e.g., "San Jose, CA") = highest priority
                                if city_name in text_lower and state_abbr and state_abbr in text_lower:
                                    score += 10
                                # Prefer entries that look like a city (not a neighborhood or zip)
                                # City entries are typically shorter and match "City, ST" pattern
                                if re.search(rf"^{re.escape(city_name)}\s*,\s*{re.escape(state_abbr)}", text_lower):
                                    score += 20  # Exact start match is best
                                elif city_name in text_lower:
                                    score += 5
                                # Penalize very long entries (likely neighborhoods/addresses)
                                if len(text) > 40:
                                    score -= 2
                                # Prefer items containing "city" label
                                if "city" in text_lower:
                                    score += 3
                                    
                                if score > best_score:
                                    best_score = score
                                    best_match = idx
                            except Exception:
                                continue
                        
                        if best_match is not None:
                            chosen = suggestions.nth(best_match)
                            chosen_text = (chosen.text_content() or "").strip()
                            print(f"   ✅ Selecting suggestion [{best_match}]: '{chosen_text[:60]}' (score={best_score})")
                            chosen.click()
                            suggestion_clicked = True
                            page.wait_for_timeout(1500)
                            break
                except Exception:
                    continue
            
            if not suggestion_clicked:
                # Retry: click input again, clear, and retype
                print("   No suggestions found on first try. Retrying...")
                search_input.click()
                page.wait_for_timeout(300)
                page.keyboard.press("Control+a")
                page.keyboard.press("Backspace")
                page.wait_for_timeout(500)
                # Type just the city name (without state) to get broader matches
                page.keyboard.type(city_name, delay=120)
                page.wait_for_timeout(3000)
                
                for selector in suggestion_selectors:
                    try:
                        suggestions = page.locator(selector)
                        count = suggestions.count()
                        if count > 0 and suggestions.first.is_visible(timeout=1000):
                            print(f"   Retry: Found {count} suggestions using: {selector}")
                            for idx in range(min(count, 8)):
                                try:
                                    text = (suggestions.nth(idx).text_content() or "").strip()
                                    print(f"      [{idx}] '{text[:80]}'")
                                except Exception:
                                    pass
                            # Click the first one
                            suggestions.first.click()
                            suggestion_clicked = True
                            print(f"   ✅ Clicked first suggestion on retry")
                            page.wait_for_timeout(1500)
                            break
                    except Exception:
                        continue
            
            if not suggestion_clicked:
                print("   No autocomplete found after retry. Trying ArrowDown + Enter...")
                try:
                    search_input.click()
                    page.wait_for_timeout(300)
                    page.keyboard.press("ArrowDown")
                    page.wait_for_timeout(500)
                    page.keyboard.press("Enter")
                    suggestion_clicked = True
                    print("   Pressed ArrowDown + Enter")
                    page.wait_for_timeout(1500)
                except Exception as e:
                    print(f"   ArrowDown+Enter failed: {str(e)[:50]}")
            
            # Now click the Search button
            print("   Clicking Search button...")
            search_button_clicked = False
            submit_selectors = [
                "button[type='submit']",
                "button:has-text('Search')",
                "[data-testid*='search-button']",
                "[aria-label*='search' i]"
            ]
            
            for selector in submit_selectors:
                try:
                    element = page.locator(selector).first
                    if element.is_visible(timeout=1500):
                        element.click()
                        search_button_clicked = True
                        print(f"   Clicked Search button: {selector}")
                        break
                except Exception:
                    continue
            
            if not search_button_clicked:
                # Fallback: press Enter
                print("   No Search button found, pressing Enter...")
                search_input.press("Enter")
            
            # Wait for navigation to results page
            print("   Waiting for navigation to results...")
            try:
                page.wait_for_url("**/for_rent/**", timeout=12000)
                print(f"   ✅ Navigated to search results: {page.url}")
            except Exception:
                page.wait_for_timeout(3000)
                print(f"   Current URL after search: {page.url}")
        else:
            print("   Error: Could not find search input field")
        
        page.wait_for_timeout(4000)
        
        print("STEP 4: Apply bedroom filter if needed...")
        if request.min_beds > 0:
            print(f"   Looking for {request.min_beds}+ bedroom filter...")
            
            # Wait for filters to load
            page.wait_for_timeout(2000)
            
            # Try multiple approaches to find and click bedroom filter
            bedroom_clicked = False
            
            # Approach 1: Look for specific bedroom filter buttons
            bedroom_selectors = [
                f"button:has-text('{request.min_beds}+ Beds')",
                f"button:has-text('{request.min_beds}+ bed')",
                f"button:has-text('{request.min_beds} Bed')",
                f"[aria-label*='{request.min_beds} bed']",
                f"[data-testid*='bed'][aria-label*='{request.min_beds}']",
                "[data-testid*='bedroom-filter']",
                "[data-testid*='beds-filter']",
                "button[aria-label*='bedroom']",
                "button[aria-label*='beds']",
                ".filter button:has-text('Bed')",
                "[data-testid*='bed'] button"
            ]
            
            print(f"   Trying {len(bedroom_selectors)} bedroom filter selectors...")
            for i, selector in enumerate(bedroom_selectors):
                try:
                    element = page.locator(selector).first
                    if element.is_visible(timeout=800):  # Reduced timeout since URL filtering is primary
                        element.click()
                        bedroom_clicked = True
                        print(f"   ✅ Applied bedroom filter using selector #{i+1}: {selector}")
                        page.wait_for_timeout(3000)  # Wait for results to update
                        break
                    else:
                        print(f"      Selector #{i+1} not visible: {selector}")
                except Exception as e:
                    print(f"      Selector #{i+1} failed: {selector} - {str(e)[:50]}")
                    continue
            
            # Approach 2: Look for general bedroom/bed filter and then select specific number
            if not bedroom_clicked:
                print("   Trying general bed filter approach...")
                general_bed_selectors = [
                    "button:has-text('Beds')",
                    "[aria-label*='bed filter']", 
                    ".filter:has-text('bed') button",
                    ".filter:has-text('Bed') button"
                ]
                
                for selector in general_bed_selectors:
                    try:
                        filter_button = page.locator(selector).first
                        if filter_button.is_visible(timeout=800):  # Reduced timeout
                            print(f"   Found general bed filter: {selector}")
                            filter_button.click()
                            page.wait_for_timeout(1000)
                            
                            # Now look for specific bedroom count options
                            specific_selectors = [
                                f"button:has-text('{request.min_beds}+')",
                                f"button:has-text('{request.min_beds} Bed')",
                                f"[data-value='{request.min_beds}']",
                                f"li:has-text('{request.min_beds}+ Bed')"
                            ]
                            
                            for specific_sel in specific_selectors:
                                try:
                                    option = page.locator(specific_sel).first
                                    if option.is_visible(timeout=500):  # Reduced timeout
                                        option.click()
                                        bedroom_clicked = True
                                        print(f"   ✅ Selected {request.min_beds}+ beds option")
                                        page.wait_for_timeout(3000)
                                        break
                                except Exception:
                                    continue
                            
                            if bedroom_clicked:
                                break
                    except Exception:
                        continue
            
            if not bedroom_clicked:
                print(f"   ⚠️  Could not find/click bedroom filter for {request.min_beds}+ beds")
                print("   Continuing with local filtering only...")
            
        else:
            print("   No minimum bedroom requirement set")

        # Wait for any filter changes to take effect
        page.wait_for_timeout(2000)

        # Dismiss popups
        for sel in ["button:has-text('Accept')", "#onetrust-accept-btn-handler",
                     "[aria-label='Close']", "button:has-text('Got It')",
                     "button:has-text('No Thanks')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # Scroll to load
        for _ in range(5):
            page.evaluate("window.scrollBy(0, 700)")
            page.wait_for_timeout(800)

        print("STEP 5: Extract rental listings...")
        
        # Debug: Check current URL and page content
        current_url = page.url
        print(f"   Current URL: {current_url}")
        
        # Debug: Count various types of elements to understand page structure
        all_divs = page.locator("div").count()
        all_articles = page.locator("article").count()
        all_cards = page.locator("[class*='card']").count()
        all_properties = page.locator("[data-testid*='property']").count()
        
        print(f"   Page structure debug: {all_divs} divs, {all_articles} articles, {all_cards} cards, {all_properties} property elements")
        
        # Wait for actual content to load (not just loading placeholders)
        print("   Waiting for listings to load...")
        for attempt in range(6):
            try:
                # Check if we still have loading placeholders
                loading_count = page.locator("[data-testid*='loading-property']").count()
                actual_count = page.locator("[data-testid*='property-card']:not([data-testid*='loading'])").count()
                
                if attempt == 0 or loading_count == 0 or actual_count > 0:
                    print(f"   Found {actual_count} property cards, {loading_count} loading placeholders")
                    break
                    
                page.wait_for_timeout(1000)
            except Exception:
                page.wait_for_timeout(1000)
        
        # Debug: Try to find what elements are actually on the page
        debug_selectors = [
            "[data-testid*='property']",
            "[class*='Property']",
            "[class*='Card']",
            "[class*='listing']",
            "[class*='rental']",
            "article",
            ".result"
        ]
        
        print("   Debugging available elements:")
        for selector in debug_selectors:
            try:
                count = page.locator(selector).count()
                if count > 0:
                    print(f"      {selector}: {count} elements")
                    # Get some sample text from first element
                    first_text = page.locator(selector).first.text_content()[:100] if count > 0 else ""
                    if first_text.strip():
                        print(f"         Sample text: {first_text.strip()[:50]}...")
            except Exception:
                pass
        
        # Strategy 1: Try to find actual property cards
        seen = set()
        cards = []
        
        # Try different selectors for actual property cards
        property_selectors = [
            "[data-testid*='property-card']:not([data-testid*='loading'])",
            "[data-testid*='property']",
            "[class*='PropertyCard']",
            "[class*='property']:not([class*='loading'])",
            "article[class*='Property']",
            "article",
            ".result"
        ]
        
        print("   Trying property card selectors:")
        for i, selector in enumerate(property_selectors):
            try:
                potential_cards = page.locator(selector).all()
                print(f"      Selector {i+1} ({selector}): {len(potential_cards)} elements")
                if len(potential_cards) > 0:
                    print(f"   Using {len(potential_cards)} elements from: {selector}")
                    cards = potential_cards
                    break
            except Exception as e:
                print(f"      Selector {i+1} failed: {str(e)[:50]}")
        
        for card in cards:
            if len(listings) >= request.max_results:
                break
            try:
                # Wait a bit and scroll to element to ensure it's loaded
                try:
                    card.scroll_into_view_if_needed(timeout=5000)
                    page.wait_for_timeout(200)  # Reduced wait time
                except Exception:
                    pass
                
                # Try different methods to get card text
                text = ""
                try:
                    text = card.inner_text(timeout=3000).strip()
                except Exception:
                    try:
                        text = card.text_content() or ""
                    except Exception:
                        try:
                            html_text = card.inner_html()
                            # Basic HTML tag removal for debugging
                            text = re.sub(r'<[^>]+>', ' ', html_text)
                            text = re.sub(r'\s+', ' ', text).strip()
                        except Exception:
                            continue
                
                lines = [l.strip() for l in text.splitlines() if l.strip()]
                
                if len(lines) < 1:  # Skip if no content
                    continue

                rent = "N/A"
                beds = "N/A"
                baths = "N/A"
                address_parts = []

                for ln in lines:
                    # Skip nav/badge lines
                    if ln.lower() in ("use arrow keys to navigate", "check availability",
                                      "total price", "tour", "contact") or ln.isupper():
                        continue
                    # Price - more flexible patterns
                    if re.search(r"\$[\d,]+(?:/mo|/month)?", ln, re.IGNORECASE) and rent == "N/A":
                        rent = ln
                    # Beds - more flexible patterns including Studio
                    elif re.search(r"(?:studio|(\d+)\s*(?:bd|bed|bedroom|br)\b)", ln, re.IGNORECASE) and beds == "N/A":
                        m = re.search(r"(?:studio|(\d+)\s*(?:bd|bed|bedroom|br)\b)", ln, re.IGNORECASE)
                        beds = "Studio" if "studio" in ln.lower() else (m.group(1) if m and m.group(1) else "Studio")
                    # Baths - more flexible patterns including decimals
                    elif re.search(r"(\d+(?:\.\d+)?)\s*(?:ba|bath|bathroom)\b", ln, re.IGNORECASE) and baths == "N/A":
                        m = re.search(r"(\d+(?:\.\d+)?)\s*(?:ba|bath|bathroom)\b", ln, re.IGNORECASE)
                        baths = m.group(1) if m else baths
                    # Combined bed/bath pattern like "Studio-2 Beds" followed by "1-2 Baths" 
                    elif re.search(r"(\d+)-(\d+)\s*(?:bath|ba)", ln, re.IGNORECASE) and baths == "N/A":
                        m = re.search(r"(\d+)-(\d+)\s*(?:bath|ba)", ln, re.IGNORECASE)
                        baths = f"{m.group(1)}-{m.group(2)}" if m else baths
                    elif re.search(r"(\d+(?:\.\d+)?)\s*(?:bath|ba)", ln, re.IGNORECASE) and baths == "N/A":
                        m = re.search(r"(\d+(?:\.\d+)?)\s*(?:bath|ba)", ln, re.IGNORECASE)
                        baths = m.group(1) if m else baths
                    # Combined bed/bath pattern like "2 bed, 1 bath" or "2br/1ba"
                    elif re.search(r"(\d+)\s*(?:bed|br).*?(\d+(?:\.\d+)?)\s*(?:bath|ba)", ln, re.IGNORECASE):
                        m = re.search(r"(\d+)\s*(?:bed|br).*?(\d+(?:\.\d+)?)\s*(?:bath|ba)", ln, re.IGNORECASE)
                        if beds == "N/A":
                            beds = m.group(1)
                        if baths == "N/A": 
                            baths = m.group(2)
                    # Compact format like "2bd/1ba"
                    elif re.search(r"(\d+)bd/(\d+(?:\.\d+)?)ba", ln, re.IGNORECASE):
                        m = re.search(r"(\d+)bd/(\d+(?:\.\d+)?)ba", ln, re.IGNORECASE)
                        if beds == "N/A":
                            beds = m.group(1)
                        if baths == "N/A":
                            baths = m.group(2)
                    # Address lines - more flexible patterns
                    elif (re.search(r"\d+\s+\w+.*(Rd|Ave|St|Dr|Blvd|Ct|Way|Ln|Pl|Circle|Pkwy)", ln, re.IGNORECASE) or 
                          re.search(r"\w+\s*,?\s*\w{2}\s*,?\s*\d{5}", ln, re.IGNORECASE) or
                          re.search(r"\w+\s+(Ave|St|Dr|Blvd|Way|Rd|Ct|Ln|Circle)", ln, re.IGNORECASE) or
                          (len(ln) > 15 and "," in ln and not re.search(r"\$|\d+\s*(?:bed|bath|br|ba)", ln, re.IGNORECASE))):
                        address_parts.append(ln.rstrip(",").strip())

                address = ", ".join(address_parts) if address_parts else ""
                
                # If no address found from structured data, try to find it in all text
                if not address:
                    for ln in lines:
                        if "," in ln and not re.search(r"\$|\d+\s*(?:bed|bath)", ln, re.IGNORECASE):
                            address = ln.strip()
                            break
                
                # Check if this property meets the bedroom requirement
                meets_bed_requirement = True
                if request.min_beds > 0:
                    if beds == "N/A" or beds == "Studio":
                        meets_bed_requirement = False
                    elif beds.isdigit() and int(beds) < request.min_beds:
                        meets_bed_requirement = False
                
                # Debug output for first few cards
                if len(listings) <= 2:
                    requirement_status = "✅ Meets requirement" if meets_bed_requirement else "❌ Filtered out"
                    print(f"   DEBUG - Parsed: Address='{address[:30]}...', Rent='{rent}', Beds='{beds}', Baths='{baths}' - {requirement_status}")
                
                if address and rent != "N/A" and meets_bed_requirement:  # Require address, rent, and bedroom match
                    key = address.lower()
                    if key not in seen:
                        seen.add(key)
                        listings.append({
                            "address": address,
                            "rent": rent,
                            "beds": beds,
                            "baths": baths,
                        })
            except Exception:
                continue

        # Strategy 2: body text fallback
        if not listings:
            print("   Strategy 1 found 0 — trying body text...")
            body = page.inner_text("body")
            lines = [l.strip() for l in body.splitlines() if l.strip()]
            i = 0
            while i < len(lines) and len(listings) < request.max_results:
                ln = lines[i]
                if re.search(r"\$[\d,]+", ln):
                    price = ln
                    # Look around for address and bed/bath info
                    context_lines = lines[max(0, i-3):i+5]
                    address = ""
                    beds = "N/A"
                    baths = "N/A"
                    for cl in context_lines:
                        if re.search(r"(CA|,\s*CA)", cl, re.IGNORECASE) and not address:
                            address = cl
                        beds_m = re.search(r"(\d+)\s*(?:bd|bed|br)", cl, re.IGNORECASE)
                        baths_m = re.search(r"(\d+)\s*(?:ba|bath)", cl, re.IGNORECASE)
                        if beds_m:
                            beds = beds_m.group(1)
                        if baths_m:
                            baths = baths_m.group(1)
                    if address:
                        key = address.lower()
                        if key not in seen:
                            seen.add(key)
                            listings.append({
                                "address": address,
                                "rent": price,
                                "beds": beds,
                                "baths": baths,
                            })
                i += 1

        if not listings:
            print("❌ ERROR: Extraction failed — no listings found.")

        print(f"\nDONE – Top {len(listings)} Rental Listings:")
        for i, l in enumerate(listings, 1):
            print(f"  {i}. {l['address']}")
            print(f"     Rent: {l['rent']}  |  Beds: {l['beds']}  |  Baths: {l['baths']}")

    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        timer.cancel()
        try:
            context.close()
        except Exception:
            pass
    return TruliaSearchResult(
        location=request.location,
        listings=[TruliaListing(address=l['address'], rent=l['rent'],
                                beds=l['beds'], baths=l['baths']) for l in listings],
    )


def test_trulia_homes():
    from playwright.sync_api import sync_playwright
    request = TruliaSearchRequest(location="San Jose, CA", min_beds=2, max_results=5)
    with sync_playwright() as pl:
        result = search_trulia_homes(pl, request)
    print(f"\nTotal listings: {len(result.listings)}")
    for i, l in enumerate(result.listings, 1):
        print(f"  {i}. {l.address}  {l.rent}")


if __name__ == "__main__":
    test_trulia_homes()