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

        pages = await stagehand.context.pages()
        page = pages[0] if pages else await stagehand.context.new_page()

        print("Navigating: the orange indicator should already be active.")
        await page.goto("https://example.com", wait_until="load")
        await asyncio.sleep(1.5)

        print(f"Reading the page title: {await page.title()}")
        await asyncio.sleep(4)
        print("The indicator should still be active. Closing Stagehand now.")
    finally:
        await stagehand.close()


if __name__ == "__main__":
    asyncio.run(main())
