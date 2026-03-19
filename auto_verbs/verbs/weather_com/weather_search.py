"""
Auto-generated Playwright script (Python)
Weather.com – Weather Forecast
Location: "Seattle, WA"
Extract: current temperature, conditions, 5-day forecast.

Uses Playwright persistent context with real Chrome Default profile.
IMPORTANT: Close ALL Chrome windows before running!
"""

import os
import re
import traceback
from playwright.sync_api import Playwright, sync_playwright

import sys as _sys, os as _os, shutil
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), '..'))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
from dataclasses import dataclass, field






@dataclass(frozen=True)
class WeatherForecastRequest:
    location: str


@dataclass(frozen=True)
class WeatherDay:
    day: str
    high: str
    low: str
    conditions: str


@dataclass(frozen=True)
class WeatherForecastResult:
    location: str
    current_temp: str
    current_conditions: str
    forecast: list


def get_weather_forecast(playwright, request: WeatherForecastRequest) -> WeatherForecastResult:
    print("=" * 59)
    print("  Weather.com – Weather Forecast")
    print("=" * 59)
    print(f'  Location: "{request.location}"\n')
    
    port = get_free_port()
    profile_dir = get_temp_profile_dir("weather_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    result = {"current": {"temperature": "N/A", "conditions": "N/A"}, "forecast": []}

    try:
        # ── Navigate to weather.com ───────────────────────────────────
        print(f"Loading: https://weather.com")
        page.goto("https://weather.com", wait_until="domcontentloaded", timeout=30000)
        # Wait for the full header search box to appear (not just the minimal homepage widget)
        try:
            page.wait_for_selector("header input[type='text']", timeout=10000)
            print("Full header search box detected")
        except Exception:
            page.wait_for_timeout(2000)

        # ── Dismiss popups ────────────────────────────────────────────
        for sel in [
            "#onetrust-accept-btn-handler",
            "button.onetrust-close-btn-handler",
            "button:has-text('Accept All')",
            "button:has-text('Accept')",
            "button:has-text('Got it')",
            "button:has-text('No, thanks')",
            "[data-testid='close-button']",
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── Search for the location ────────────────────────────────────────
        print(f'Searching for "{request.location}"...')

        # Set up network interception to capture the autocomplete API response
        # This gives us the location URL directly without needing to click suggestions
        location_url = None

        def handle_response(response):
            nonlocal location_url
            if location_url:
                return
            url = response.url
            # weather.com uses https://api.weather.com/v3/location/search
            if "v3/location" not in url and "v1/location" not in url:
                return
            try:
                data = response.json()
                # v3/location/search returns {"location": {"placeId": [...], ...}}
                loc = data.get("location", {})
                place_ids = loc.get("placeId") or []
                if place_ids:
                    location_url = f"https://weather.com/weather/today/l/{place_ids[0]}"
                    print(f"  Captured location URL from API: {location_url}")
            except Exception:
                pass

        page.on("response", handle_response)

        # Wait for page to fully load
        page.wait_for_timeout(2000)

        # Debug: Check all input elements on the page
        all_inputs = page.locator("input").all()
        print(f"DEBUG: Found {len(all_inputs)} input elements on page")
        for i, inp in enumerate(all_inputs[:5]):
            try:
                placeholder = inp.get_attribute("placeholder") or ""
                input_type = inp.get_attribute("type") or ""
                input_id = inp.get_attribute("id") or ""
                print(f"  Input {i+1}: type='{input_type}' placeholder='{placeholder}' id='{input_id}'")
            except Exception:
                pass

        # Prefer the full header search box which has proper BUTTON suggestions
        search_input = None
        search_selectors = [
            "header input[type='text']",  # Best: has proper clickable BUTTON suggestions
            "input[aria-label='Search for a location']",
            "input[id*='LocationSearch']",
            "#LocationSearch_input",
            "input[aria-label*='Search']",
            "input[type='search']",
            "[role='searchbox']",
            "input[placeholder*='City']",
            "input[placeholder*='location']",
            "input[placeholder*='City, State']",
            "input[id*='search']",
            "input[placeholder*='Search']"  # Last resort: simpler widget whose suggestions don't navigate
        ]

        for selector in search_selectors:
            try:
                test_input = page.locator(selector).first
                if test_input.is_visible(timeout=2000):
                    search_input = test_input
                    print(f"Found search input with selector: {selector}")
                    break
            except Exception:
                continue

        if not search_input:
            print("Could not find search input with any selector. Trying first visible text input...")
            try:
                fallback_input = page.locator("input[type='text']").first
                if fallback_input.is_visible(timeout=2000):
                    search_input = fallback_input
                    print("Using first visible text input as fallback")
            except Exception:
                pass

        if not search_input:
            print("Could not find any suitable search input!")
            return WeatherForecastResult(
                location=request.location,
                current_temp="N/A",
                current_conditions="N/A",
                forecast=[]
            )
        
        # Improved search interaction
        try:
            # Focus and clear the input
            search_input.click()
            page.wait_for_timeout(1000)
            search_input.clear()

            # Type the location slowly to trigger autocomplete API calls
            print("Typing location...")
            search_input.type(request.location, delay=100)
            print("Waiting for suggestions / API response...")
            page.wait_for_timeout(2000)

            # Navigate using the URL captured from the API interception
            if not location_url:
                print(f"ERROR: Could not capture location URL from API for '{request.location}'")
                return WeatherForecastResult(
                    location=request.location,
                    current_temp="N/A",
                    current_conditions="N/A",
                    forecast=[]
                )

            print(f"Using captured location URL: {location_url}")
            page.goto(location_url, timeout=15000)
            page.wait_for_load_state("domcontentloaded", timeout=10000)
            print(f"Navigation completed to: {page.url}")
                
        except Exception as e:
            print(f"Search interaction failed: {e}")
            import traceback
            traceback.print_exc()
            
        print(f"  Current URL: {page.url}")
        print(f"  Page title: {page.title()}")
        print()

        # ── Extract current conditions (improved selectors) ────────────────────────────────
        print("Extracting current conditions...")
        page.wait_for_timeout(2000)  # Allow page to fully load
        
        # Try modern weather.com selectors first
        temp_selectors = [
            "[data-testid='TemperatureValue']",
            "span[data-testid='TemperatureValue']", 
            "[class*='CurrentConditions--tempValue']",
            "[class*='temp']",
            "div[class*='temperature'] span",
            ".today-temperature",
            ".current-temperature"
        ]
        
        for sel in temp_selectors:
            try:
                el = page.locator(sel).first
                if el.is_visible(timeout=2000):
                    temp_text = el.inner_text(timeout=2000).strip()
                    if temp_text and ('°' in temp_text or temp_text.isdigit()):
                        result["current"]["temperature"] = temp_text
                        print(f"Found temperature '{temp_text}' with selector: {sel}")
                        break
            except Exception:
                continue
        
        # Try weather condition selectors
        cond_selectors = [
            "[data-testid='wxPhrase']",
            "div[data-testid='wxPhrase']",
            "[class*='CurrentConditions--phraseValue']",
            "[class*='conditions']",
            ".current-conditions",
            ".weather-phrase"
        ]
        
        for sel in cond_selectors:
            try:
                el = page.locator(sel).first
                if el.is_visible(timeout=2000):
                    cond_text = el.inner_text(timeout=2000).strip()
                    if cond_text and len(cond_text) > 2:
                        result["current"]["conditions"] = cond_text
                        print(f"Found conditions '{cond_text}' with selector: {sel}")
                        break
            except Exception:
                continue
        
        # Enhanced fallback with page text parsing
        if result["current"]["temperature"] == "N/A" or result["current"]["conditions"] == "N/A":
            try:
                body_text = page.evaluate("document.body.innerText") or ""
                lines = [l.strip() for l in body_text.split("\n") if l.strip()]
                
                # Look for temperature pattern
                if result["current"]["temperature"] == "N/A":
                    for line in lines[:20]:  # Check first 20 lines
                        temp_match = re.search(r'(\d{1,3}°[CF]?)', line)
                        if temp_match:
                            result["current"]["temperature"] = temp_match.group(1)
                            print(f"Found temperature in text: {temp_match.group(1)}")
                            break
                
                # Look for weather conditions
                if result["current"]["conditions"] == "N/A":
                    weather_words = ["sunny", "cloudy", "rain", "snow", "clear", "partly", "mostly", 
                                   "overcast", "fog", "showers", "fair", "windy", "thunderstorm"]
                    for line in lines[:30]:  # Check first 30 lines
                        if any(w in line.lower() for w in weather_words) and len(line) < 50:
                            result["current"]["conditions"] = line
                            print(f"Found conditions in text: {line}")
                            break
            except Exception as e:
                print(f"Text parsing fallback failed: {e}")

        # ── Navigate to 5-day forecast ────────────────────────────────
        print("Navigating to 5-day forecast...")
        try:
            link = page.locator("a[href*='5day'], a:has-text('5 Day')").first
            if link.is_visible(timeout=3000):
                link.evaluate("el => el.click()")
                page.wait_for_timeout(2000)
        except Exception:
            # Try appending /weather/5day to URL
            current_url = page.url
            if "/weather/" in current_url and "/5day" not in current_url:
                five_day_url = current_url.split("/weather/")[0] + "/weather/5day/" + current_url.split("/weather/")[1].split("/")[1] if "/weather/" in current_url else current_url
                page.goto(five_day_url, timeout=15000)
                page.wait_for_timeout(2000)

        # ── Extract 5-day forecast ────────────────────────────────────
        print("Extracting 5-day forecast...")
        body_text = page.evaluate("document.body.innerText") or ""
        lines = [l.strip() for l in body_text.split("\n") if l.strip()]

        # Include abbreviated day names like "Tue 03", "Wed 04"
        day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
                     "Saturday", "Sunday", "Today", "Tonight",
                     "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
        seen_days = set()  # Track seen days to avoid duplicates
        for i, line in enumerate(lines):
            # Check if line starts with a day name (or abbreviated with date)
            matched_day = None
            for d in day_names:
                # Match "Today", "Tonight", "Tuesday", or "Tue 03" patterns
                if (line == d or line.startswith(d + " ") or 
                    re.match(rf'^{d}\s+\d{{1,2}}$', line)):
                    if line not in seen_days:
                        matched_day = d
                        break
            
            if matched_day and len(result["forecast"]) < 5:
                seen_days.add(line)  # Track full line to avoid exact duplicates
                day = {"day": line, "high": "N/A", "low": "N/A", "conditions": "N/A"}
                # Look ahead for temps and conditions
                for j in range(i + 1, min(len(lines), i + 8)):
                    cand = lines[j]
                    # Temperature pattern
                    temp_match = re.search(r'(\d+)°\s*/\s*(\d+)°', cand)
                    if temp_match:
                        day["high"] = temp_match.group(1) + "°"
                        day["low"] = temp_match.group(2) + "°"
                        continue
                    if re.match(r'^\d+°$', cand) and day["high"] == "N/A":
                        day["high"] = cand
                        continue
                    if re.match(r'^\d+°$', cand) and day["low"] == "N/A":
                        day["low"] = cand
                        continue
                    # Conditions — common weather words
                    if any(w in cand.lower() for w in ["rain", "sun", "cloud", "snow",
                            "clear", "thunder", "fog", "overcast", "partly", "mostly",
                            "showers", "drizzle", "windy", "fair"]):
                        if day["conditions"] == "N/A":
                            day["conditions"] = cand
                result["forecast"].append(day)

        print("Weather data extraction completed.")

    except Exception as e:
        print(f"\nError: {e}")
        traceback.print_exc()
    finally:
        try:
            browser.close()
        except Exception:
            pass
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)

    current = result.get('current', {})
    return WeatherForecastResult(
        location=request.location,
        current_temp=current.get('temperature', 'N/A'),
        current_conditions=current.get('conditions', 'N/A'),
        forecast=[WeatherDay(day=d['day'], high=d['high'], low=d['low'], conditions=d['conditions']) for d in result.get('forecast', [])],
    )



def test_weather_forecast(location: str):
    from playwright.sync_api import sync_playwright
    request = WeatherForecastRequest(location=location)
    with sync_playwright() as pl:
        result = get_weather_forecast(pl, request)
    
    # ── Print results ─────────────────────────────────────────────
    print(f"\n{'=' * 59}")
    print("  Final Results")
    print(f"{'=' * 59}")
    print(f"\n  Current Conditions:")
    print(f"     Temperature: {result.current_temp}")
    print(f"     Conditions:  {result.current_conditions}")
    print(f"\n  5-Day Forecast:")
    for i, d in enumerate(result.forecast, 1):
        print(f"     {i}. {d.day}: High {d.high}, Low {d.low} — {d.conditions}")
    print()


if __name__ == "__main__":
    try:
        test_weather_forecast("Seattle, WA")
    except Exception as e:
        print(f"Error running weather forecast: {e}")
        import traceback
        traceback.print_exc()
