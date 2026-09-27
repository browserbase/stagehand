"""Extract current Philadelphia City Council events with Stagehand V4."""

import asyncio
import json
import os
from datetime import UTC, datetime

from dotenv import load_dotenv
from pydantic import BaseModel

from stagehand import Stagehand, browserbase

load_dotenv()


class CouncilEvent(BaseModel):
    name: str
    date: str
    time: str


class CouncilEvents(BaseModel):
    results: list[CouncilEvent]


async def main() -> None:
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")

    year = datetime.now(UTC).year
    print(f"Starting Philadelphia Council Events automation for {year}...")
    browser = await browserbase.launch(api_key=api_key)
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            await page.goto(
                "https://phila.legistar.com/",
                wait_until="domcontentloaded",
                timeout=60_000,
            )
            await stagehand.act("Click Calendar in the navigation menu", page=page)
            await stagehand.act(f"Select {year} from the year dropdown", page=page)
            page = await browser.context.active_page() or page
            if "Calendar.aspx" not in await page.url():
                await page.goto(
                    "https://phila.legistar.com/Calendar.aspx",
                    wait_until="domcontentloaded",
                    timeout=60_000,
                )
            await stagehand.observe(
                f"Find the calendar table rows for {year}",
                page=page,
            )

            extracted = await stagehand.extract(
                (
                    f"Extract every {year} event visible in the calendar table with its "
                    "name, date, and time"
                ),
                CouncilEvents,
                page=page,
            )
            print(f"Found {len(extracted.data.results)} events")
            print(json.dumps(extracted.data.model_dump(mode="json"), indent=2))
        finally:
            await stagehand.close()
    finally:
        await browser.close()
        print("Session closed successfully")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Application error: {error}")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        raise
