import asyncio
import json
import os

from pydantic import BaseModel

from stagehand import Stagehand

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
if not OPENAI_API_KEY:
    raise RuntimeError


class PageInfo(BaseModel):
    heading: str
    description: str


async def main() -> None:
    stagehand = Stagehand({
        "browser": {"type": "local", "headless": True},
        "model": {
            "model_name": "openai/gpt-5.4-mini",
            "api_key": OPENAI_API_KEY,
        },
    })

    try:
        await stagehand.init()

        page = await stagehand.context.active_page()
        if page is None:
            raise RuntimeError("Stagehand initialized without an active page")
        await page.goto("https://example.com")

        page_info = await stagehand.extract(
            "Extract the page heading and description",
            PageInfo,
        )

        print(json.dumps(page_info.model_dump(mode="json"), indent=2))
    finally:
        await stagehand.close()


if __name__ == "__main__":
    asyncio.run(main())
