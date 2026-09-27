"""Verify geolocation proxies with live weather data and Stagehand V4."""

import asyncio
import os
from dataclasses import dataclass

from dotenv import load_dotenv
from pydantic import BaseModel

from stagehand import BrowserbaseProxyConfig, Stagehand, browserbase

load_dotenv()

EXPECTED_COUNTRIES = {
    "US": "United States",
    "GB": "United Kingdom",
    "JP": "Japan",
    "BR": "Brazil",
}


@dataclass(frozen=True)
class Geolocation:
    city: str
    country: str
    state: str | None = None


@dataclass(frozen=True)
class WeatherResult:
    city: str
    country: str
    temperature: float
    conditions: str
    reported_location: str
    reported_country: str


class ExtractedWeather(BaseModel):
    temperature: float
    conditions: str
    reported_location: str
    reported_country: str


async def get_weather_for_location(location: Geolocation) -> WeatherResult:
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")

    city_name = location.city.replace("_", " ")
    proxy: BrowserbaseProxyConfig = {
        "type": "browserbase",
        "geolocation": {
            "city": location.city,
            "country": location.country,
            **({"state": location.state} if location.state else {}),
        },
    }

    print(f"Getting live weather for {city_name}, {location.country}")
    browser = await browserbase.launch(api_key=api_key, proxies=[proxy])
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            await page.goto(
                "https://wttr.in/?format=j1",
                wait_until="domcontentloaded",
                timeout=60_000,
            )
            extracted = await stagehand.extract(
                (
                    "Extract the current temperature in Celsius, current weather description, "
                    "nearest reported city or area, and reported country from this weather JSON"
                ),
                ExtractedWeather,
                page=page,
            )
            weather = extracted.data
            temperature = weather.temperature
            conditions = weather.conditions.strip()
            reported_location = weather.reported_location.strip()
            reported_country = weather.reported_country.strip()

            if not conditions or not reported_location or not reported_country:
                raise RuntimeError("Weather service returned incomplete current conditions")
            expected_country = EXPECTED_COUNTRIES[location.country]
            if expected_country.lower() not in reported_country.lower():
                raise RuntimeError(
                    f"Proxy mismatch: expected {expected_country}, received {reported_country}"
                )

            return WeatherResult(
                city=city_name,
                country=location.country,
                temperature=temperature,
                conditions=conditions,
                reported_location=reported_location,
                reported_country=reported_country,
            )
        finally:
            await stagehand.close()
    finally:
        await browser.close()


async def main() -> None:
    locations = [
        Geolocation("NEW_YORK", "US", "NY"),
        Geolocation("LONDON", "GB"),
        Geolocation("TOKYO", "JP"),
        Geolocation("SAO_PAULO", "BR"),
    ]
    results = [await get_weather_for_location(location) for location in locations]

    print("\n=== Weather Results ===")
    for result in results:
        print(
            f"{result.city}, {result.country}: {result.temperature} °C, "
            f"{result.conditions} (reported near {result.reported_location}, "
            f"{result.reported_country})"
        )
    print("All four proxy locations returned validated live weather")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Application error: {error}")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        raise
