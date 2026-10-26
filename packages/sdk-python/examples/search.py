import asyncio
import os

from stagehand import browserbase


async def main() -> None:
    search_result = await browserbase.search(
        api_key=os.environ["BROWSERBASE_API_KEY"],
        query="browser agent frameworks",
        num_results=5,
    )
    for result in search_result.results:
        print(f"{result.title}: {result.url}")


if __name__ == "__main__":
    asyncio.run(main())
