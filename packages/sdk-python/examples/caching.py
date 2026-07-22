import asyncio
import json
import os
from time import perf_counter

from pydantic import BaseModel

from stagehand import Stagehand


class Company(BaseModel):
    name: str
    description: str


class Companies(BaseModel):
    companies: list[Company]


async def main() -> None:
    # Server-side caching requires a Browserbase browser session.
    stagehand = Stagehand(
        api_key=os.environ["BROWSERBASE_API_KEY"],
        browser="browserbase",
        model="openai/gpt-5.4-mini",
        model_api_key=os.environ["OPENAI_API_KEY"],
    )

    try:
        await stagehand.init()

        page = await stagehand.context.active_page()
        if page is None:
            raise RuntimeError("Stagehand initialized without an active page")
        await page.goto("https://aigrant.com")

        async def extract_companies() -> tuple[Companies, int]:
            start = perf_counter()
            result = await stagehand.extract(
                instruction=(
                    "Extract the names and descriptions of the first five companies "
                    "listed on the page"
                ),
                schema=Companies,
                page=page,
                cache=True,
            )
            return result, round((perf_counter() - start) * 1000)

        first, first_duration_ms = await extract_companies()
        print(f"First extraction ({first_duration_ms}ms):")
        print(json.dumps(first.model_dump(mode="json"), indent=2))

        second, second_duration_ms = await extract_companies()
        print(f"Second extraction ({second_duration_ms}ms):")
        print(json.dumps(second.model_dump(mode="json"), indent=2))
    finally:
        await stagehand.close()


if __name__ == "__main__":
    asyncio.run(main())
