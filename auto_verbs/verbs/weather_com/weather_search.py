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
    location: str = "Seattle, WA"


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
        page.wait_for_timeout(3000)

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
        search_input = page.locator(
            "input[aria-label='Search for a location'], "
            "#LocationSearch_input, "
            "input[id*='LocationSearch'], "
            "input[placeholder*='Search City']"
        ).first
        search_input.evaluate("el => el.click()")
        page.wait_for_timeout(500)
        search_input.press("Control+a")
        search_input.fill(request.location)
        page.wait_for_timeout(2000)

        # Click the first suggestion
        try:
            suggestion = page.locator(
                "[data-testid='searchItem'], "
                "button[id*='LocationSearch_listItem']"
            ).first
            suggestion.wait_for(state="visible", timeout=5000)
            suggestion.evaluate("el => el.click()")
        except Exception:
            search_input.press("Enter")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}\n")

        # ── Extract current conditions ────────────────────────────────
        print("Extracting current conditions...")
        # Wait for page to fully render
        page.wait_for_timeout(2000)
        
        # Try multiple selector approaches
        temp_selectors = [
            "[data-testid='CurrentConditionsContainer'] [data-testid='TemperatureValue']",
            "span[data-testid='TemperatureValue']",
            "[class*='CurrentConditions--tempValue']",
            ".CurrentConditions--tempValue--MHmYY",
        ]
        for sel in temp_selectors:
            try:
                el = page.locator(sel).first
                if el.is_visible(timeout=1000):
                    result["current"]["temperature"] = el.inner_text(timeout=2000).strip()
                    break
            except Exception:
                continue
        
        cond_selectors = [
            "[data-testid='CurrentConditionsContainer'] [data-testid='wxPhrase']",
            "div[data-testid='wxPhrase']",
            "[class*='CurrentConditions--phraseValue']",
        ]
        for sel in cond_selectors:
            try:
                el = page.locator(sel).first
                if el.is_visible(timeout=1000):
                    result["current"]["conditions"] = el.inner_text(timeout=2000).strip()
                    break
            except Exception:
                continue
        
        # Fallback: parse page text for temperature pattern
        if result["current"]["temperature"] == "N/A":
            body_text = page.evaluate("document.body.innerText") or ""
            # Look for standalone temperature like "60°" at start of line
            temp_match = re.search(r'^(\d{1,3}°)$', body_text, re.MULTILINE)
            if temp_match:
                result["current"]["temperature"] = temp_match.group(1)
        
        # Fallback: look for conditions near temperature in page text
        if result["current"]["conditions"] == "N/A":
            if "body_text" not in dir():
                body_text = page.evaluate("document.body.innerText") or ""
            lines = [l.strip() for l in body_text.split("\n") if l.strip()]
            weather_words = ["sunny", "cloudy", "rain", "snow", "clear", "partly cloudy",
                            "mostly cloudy", "overcast", "fog", "showers", "fair", "windy"]
            for line in lines[:50]:  # Check first 50 lines
                if any(w in line.lower() for w in weather_words) and len(line) < 40:
                    result["current"]["conditions"] = line
                    break

        # ── Navigate to 5-day forecast ────────────────────────────────
        print("Navigating to 5-day forecast...")
        try:
            link = page.locator("a[href*='5day'], a:has-text('5 Day')").first
            if link.is_visible(timeout=3000):
                link.evaluate("el => el.click()")
                page.wait_for_timeout(4000)
        except Exception:
            # Try appending /weather/5day to URL
            current_url = page.url
            if "/weather/" in current_url and "/5day" not in current_url:
                five_day_url = current_url.split("/weather/")[0] + "/weather/5day/" + current_url.split("/weather/")[1].split("/")[1] if "/weather/" in current_url else current_url
                page.goto(five_day_url, timeout=15000)
                page.wait_for_timeout(3000)

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

        # ── Print results ─────────────────────────────────────────────
        print(f"\n{'=' * 59}")
        print("  Results")
        print(f"{'=' * 59}")
        print(f"\n  Current Conditions:")
        print(f"     Temperature: {result['current'].get('temperature', 'N/A')}")
        print(f"     Conditions:  {result['current'].get('conditions', 'N/A')}")
        print(f"\n  5-Day Forecast:")
        for i, d in enumerate(result["forecast"], 1):
            print(f"     {i}. {d['day']}: High {d['high']}, Low {d['low']} — {d['conditions']}")
        print()

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



def test_weather_forecast():
    from playwright.sync_api import sync_playwright
    request = WeatherForecastRequest(location="Seattle, WA")
    with sync_playwright() as pl:
        result = get_weather_forecast(pl, request)
    print(f"\nLocation: {result.location}")
    print(f"Current: {result.current_temp}, {result.current_conditions}")
    for d in result.forecast:
        print(f"  {d.day}: High {d.high}, Low {d.low} — {d.conditions}")


if __name__ == "__main__":
    test_weather_forecast()
