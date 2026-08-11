import asyncio
import json
import os

from pydantic import BaseModel

from stagehand import CDPSubscription, PageCDPEvent, Stagehand, browserbase

BROWSERBASE_API_KEY = os.environ.get("BROWSERBASE_API_KEY") or ""
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY") or ""
if not BROWSERBASE_API_KEY:
    raise RuntimeError("BROWSERBASE_API_KEY is required")
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is required")


class PageInfo(BaseModel):
    heading: str
    description: str


async def main() -> None:
    browser = await browserbase.launch(
        api_key=BROWSERBASE_API_KEY,
        model="openai/gpt-5.4-mini",
        model_api_key=OPENAI_API_KEY,
    )
    try:
        stagehand = await Stagehand.create(browser=browser)
        subscription: CDPSubscription | None = None
        try:
            page = await stagehand.browser.context.active_page()
            if page is None:
                raise RuntimeError("Stagehand initialized without an active page")

            console_event = asyncio.Event()
            event_method: str | None = None

            def handle_console(event: PageCDPEvent) -> None:
                nonlocal event_method
                if event.params.root.get("type") == "log":
                    event_method = event.method
                    console_event.set()

            subscription = await page.on("console", handle_console)
            await page.goto("https://example.com")
            await page.evaluate('console.log("stagehand-page-on-example"); "emitted"')
            await asyncio.wait_for(console_event.wait(), timeout=10)

            result = await stagehand.extract(
                "Extract the page heading and description",
                PageInfo,
            )
            print(
                json.dumps(
                    {
                        "event_method": event_method,
                        "extracted": result.data.model_dump(mode="json"),
                    },
                    indent=2,
                )
            )
        finally:
            if subscription is not None:
                await subscription.unsubscribe()
            await stagehand.close()
    finally:
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
