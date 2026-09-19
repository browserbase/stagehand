"""Generate a concise company value proposition with Stagehand V4."""

import asyncio
import os

from dotenv import load_dotenv
from pydantic import BaseModel

from stagehand import Stagehand, browserbase

load_dotenv()

TARGET_DOMAIN = "www.browserbase.com"


class ValueProposition(BaseModel):
    value_prop: str


class OneLiner(BaseModel):
    one_liner: str


async def generate_one_liner(domain: str) -> str:
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")

    browser = await browserbase.launch(api_key=api_key)
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            await page.goto(
                f"https://{domain}/",
                wait_until="domcontentloaded",
                timeout=300_000,
            )

            value_prop_result = await stagehand.extract(
                "Extract the value proposition from the landing page",
                ValueProposition,
                page=page,
            )
            value_prop = value_prop_result.data.value_prop.strip()
            print(f"Extracted value proposition: {value_prop}")

            formatted_result = await stagehand.extract(
                (
                    f'Using the company value proposition "{value_prop}", write a unique '
                    'English description that starts with "your", uses no quotes, avoids '
                    "generic adjectives, and is no more than 9 words"
                ),
                OneLiner,
                page=page,
            )
            one_liner = formatted_result.data.one_liner.strip()
            print(f"Generated one-liner: {one_liner}")
            return one_liner
        finally:
            await stagehand.close()
    finally:
        await browser.close()
        print("Session closed successfully")


async def main() -> None:
    print("Starting One-Liner Generator...")
    one_liner = await generate_one_liner(TARGET_DOMAIN)
    print(f"Success: {one_liner}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Error: {error}")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        raise
