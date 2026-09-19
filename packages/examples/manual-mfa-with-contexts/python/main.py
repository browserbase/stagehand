"""Persist a manually completed GitHub MFA login with Stagehand V4."""

import asyncio
import os
import time

from browserbase import AsyncBrowserbase
from dotenv import load_dotenv
from pydantic import BaseModel

from stagehand import Stagehand, browserbase

load_dotenv()


class MFAStatus(BaseModel):
    mfa_required: bool


class AuthenticationState(BaseModel):
    username: str


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


async def first_login(context_id: str) -> None:
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
            await page.goto("https://github.com/login", wait_until="domcontentloaded")
            await stagehand.act(
                "Fill the username field with %username%",
                page=page,
                variables={"username": require_env("GITHUB_USERNAME")},
            )
            await stagehand.act(
                "Fill the password field with %password%",
                page=page,
                variables={"password": require_env("GITHUB_PASSWORD")},
            )
            await stagehand.act("Click the Sign in button", page=page)

            status = await stagehand.extract(
                "Is a two-factor authentication or verification-code prompt visible?",
                MFAStatus,
                page=page,
            )
            if status.data.mfa_required:
                print("MFA is required. Open the newest Browserbase session and complete it.")
                deadline = time.monotonic() + 120
                while time.monotonic() < deadline:
                    current_url = await page.url()
                    if "/login" not in current_url and "/sessions/two-factor" not in current_url:
                        break
                    await asyncio.sleep(3)
                else:
                    raise TimeoutError("MFA was not completed within two minutes")

            print("First session authenticated and persisted")
        finally:
            await stagehand.close()
    finally:
        await browser.close()


async def verify_context(context_id: str) -> None:
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
            await page.goto("https://github.com", wait_until="domcontentloaded")
            extracted = await stagehand.extract(
                (
                    "Extract the logged-in GitHub username. Return an empty string if the page "
                    "is not authenticated."
                ),
                AuthenticationState,
                page=page,
            )
            username = extracted.data.username
            print("Second session reused GitHub authentication without another login")
            print(f"Logged-in username: {username}")
        finally:
            await stagehand.close()
    finally:
        await browser.close()


async def main() -> None:
    require_env("GITHUB_USERNAME")
    require_env("GITHUB_PASSWORD")
    async with AsyncBrowserbase(api_key=require_env("BROWSERBASE_API_KEY")) as api:
        context = await api.contexts.create()
        print("Created temporary Browserbase context")
        try:
            await first_login(context.id)
            await asyncio.sleep(5)
            await verify_context(context.id)
        finally:
            # The generated SDK currently sets a JSON content type on DELETE, so send an
            # explicit empty object instead of an empty body.
            await api.contexts.delete(context.id, extra_body={})
            print("Deleted temporary Browserbase context")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"MFA context demo failed: {error}")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        raise
