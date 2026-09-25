"""Verify Browserbase built-in and geolocation proxies with Stagehand V4."""

import asyncio
import json
import os

from dotenv import load_dotenv
from pydantic import BaseModel

from stagehand import BrowserbaseProxyConfig, Stagehand, browserbase

load_dotenv()


class GeoInfo(BaseModel):
    ip: str
    city: str
    region: str
    country: str
    loc: str
    timezone: str
    org: str
    postal: str | None
    hostname: str | None


async def test_session(proxies: bool | list[BrowserbaseProxyConfig], name: str) -> GeoInfo:
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")

    print(f"\n=== Testing {name} ===")
    browser = await browserbase.launch(api_key=api_key, proxies=proxies)
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            await page.goto("https://ipinfo.io/json", wait_until="domcontentloaded")
            extracted = await stagehand.extract(
                "Extract the complete IP geolocation record shown in this JSON response",
                GeoInfo,
                page=page,
            )
            geo_info = extracted.data
            print(json.dumps(geo_info.model_dump(mode="json"), indent=2))
            return geo_info
        finally:
            await stagehand.close()
    finally:
        await browser.close()


async def main() -> None:
    built_in = await test_session(True, "Built-in Proxies")
    new_york = await test_session(
        [
            {
                "type": "browserbase",
                "geolocation": {"city": "NEW_YORK", "state": "NY", "country": "US"},
            }
        ],
        "Geolocation Proxies (New York)",
    )

    if (
        new_york.country != "US"
        or new_york.region not in {"New York", "New Jersey"}
        or new_york.timezone != "America/New_York"
    ):
        raise RuntimeError(
            "Expected a New York metropolitan-area proxy; received "
            f"{new_york.city}, {new_york.region}, {new_york.country}"
        )
    if built_in.ip == new_york.ip:
        raise RuntimeError("Built-in and geolocation proxy sessions returned the same IP")

    print("\nAll proxy tests completed with distinct IPs")


if __name__ == "__main__":
    asyncio.run(main())
