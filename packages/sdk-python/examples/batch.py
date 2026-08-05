import asyncio
import json

from stagehand import Stagehand, local_browser


async def main() -> None:
    browser = await local_browser.launch(headless=True)
    try:
        stagehand = await Stagehand.create(browser=browser)
        try:
            result = await stagehand._experimental_batch(
                """
                async ({ page }, input) => {
                  await page.goto(input.url);
                  return {
                    title: await page.title(),
                    heading: await page.locator("h1").innerText(),
                  };
                }
                """,
                {"url": "https://example.com"},
                timeout=30_000,
            )

            print(json.dumps(result, indent=2))
        finally:
            await stagehand.close()
    finally:
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
