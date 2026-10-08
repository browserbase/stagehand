import asyncio
import os

from stagehand import browserbase


async def main() -> None:
    fetch_result = await browserbase.fetch(
        api_key=os.environ["BROWSERBASE_API_KEY"],
        url="https://example.com",
        format="markdown",
    )
    print(fetch_result.content)


if __name__ == "__main__":
    asyncio.run(main())
