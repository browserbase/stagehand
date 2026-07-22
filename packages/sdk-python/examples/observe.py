import asyncio
import json
import os

from stagehand import Stagehand


async def main() -> None:
    stagehand = Stagehand(
        browser="local",
        headless=True,
        model="openai/gpt-5.4-mini",
        model_api_key=os.environ["OPENAI_API_KEY"],
    )

    try:
        await stagehand.init()

        page = await stagehand.context.active_page()
        if page is None:
            raise RuntimeError("Stagehand initialized without an active page")
        await page.goto("https://example.com")

        actions = await stagehand.observe(
            instruction="Find the link that provides more information about Example Domain",
        )

        print(
            json.dumps(
                [action.model_dump(mode="json", by_alias=True) for action in actions],
                indent=2,
            )
        )

        if not actions:
            raise RuntimeError("observe() returned no matching actions")
    finally:
        await stagehand.close()


if __name__ == "__main__":
    asyncio.run(main())
