import asyncio
import json
import os

from pydantic import BaseModel

from stagehand import Stagehand


class PageInfo(BaseModel):
    heading: str
    description: str


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

        page_info = await page.extract(
            instruction="Extract the page heading and description",
            schema=PageInfo,
        )

        print(json.dumps(page_info.model_dump(mode="json"), indent=2))
    finally:
        await stagehand.close()


if __name__ == "__main__":
    asyncio.run(main())
