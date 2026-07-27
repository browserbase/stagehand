import asyncio

from stagehand import Stagehand


async def main() -> None:
    stagehand = Stagehand(
        browser="local",
        headless=False,
        agent_indicator=True,
    )

    try:
        await stagehand.init()

        page = await stagehand.context.active_page()
        if page is None:
            raise RuntimeError("Stagehand initialized without an active page")

        await page.goto("https://example.com", wait_until="load")
        print("The orange halo will remain visible for 60 seconds.")
        await asyncio.sleep(60)
    finally:
        await stagehand.close()


if __name__ == "__main__":
    asyncio.run(main())
