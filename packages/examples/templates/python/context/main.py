"""Persist and verify an authenticated Browserbase context with Stagehand V4."""

import asyncio
import json
import os

from browserbase import AsyncBrowserbase
from dotenv import load_dotenv
from pydantic import BaseModel, Field

from stagehand import Stagehand, browserbase

load_dotenv()

TARGET_URL = "https://www.rec.us/organizations/san-francisco-rec-park"


class UserData(BaseModel):
    full_name: str = Field(min_length=1)
    address: str = Field(min_length=1)


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


async def login_and_persist(context_id: str) -> None:
    browser = await browserbase.launch(
        api_key=require_env("BROWSERBASE_API_KEY"),
        browser_settings={"context": {"id": context_id, "persist": True}},
    )
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            await page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=60_000)
            await stagehand.act("Click the Login button", page=page)
            await stagehand.act(
                "Fill the email or username field with %email%",
                page=page,
                variables={"email": require_env("SF_REC_PARK_EMAIL")},
            )
            await stagehand.act("Click the next, continue, or submit button", page=page)
            await stagehand.act(
                "Fill the password field with %password%",
                page=page,
                variables={"password": require_env("SF_REC_PARK_PASSWORD")},
            )
            await stagehand.act("Click the login, sign in, or submit button", page=page)
        finally:
            await stagehand.close()
    finally:
        await browser.close()


async def verify_reused_context(context_id: str) -> UserData:
    browser = await browserbase.launch(
        api_key=require_env("BROWSERBASE_API_KEY"),
        browser_settings={"context": {"id": context_id, "persist": True}},
    )
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            await page.goto(TARGET_URL, wait_until="domcontentloaded", timeout=60_000)
            await stagehand.act("Click the reservations button", page=page)
            extracted = await stagehand.extract(
                "Extract the authenticated user's full name and address",
                UserData,
                page=page,
            )
            return extracted.data
        finally:
            await stagehand.close()
    finally:
        await browser.close()


async def main() -> None:
    async with AsyncBrowserbase(api_key=require_env("BROWSERBASE_API_KEY")) as api:
        context = await api.contexts.create()
        print("Created temporary Browserbase context")
        try:
            await login_and_persist(context.id)
            user = await verify_reused_context(context.id)
            print("Reused context reached authenticated profile data:")
            print(json.dumps(user.model_dump(mode="json"), indent=2))
        finally:
            # The generated SDK currently sets a JSON content type on DELETE, so send an
            # explicit empty object instead of an empty body.
            await api.contexts.delete(context.id, extra_body={})
            print("Deleted temporary Browserbase context")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Context authentication example failed: {error}")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        raise
