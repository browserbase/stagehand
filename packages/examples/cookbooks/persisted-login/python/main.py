import asyncio
import json
import os
from pathlib import Path

from browserbase import AsyncBrowserbase
from dotenv import load_dotenv
from stagehand import BrowserbaseBrowserSettings, Stagehand, browserbase

load_dotenv()


async def main() -> None:
    names = [
        "BROWSERBASE_API_KEY",
        "OPENAI_API_KEY",
        "LOGIN_USER",
        "LOGIN_PASSWORD",
    ]
    for name in names:
        if not os.environ.get(name):
            raise RuntimeError(f"{name} is required")
    api_key = os.environ["BROWSERBASE_API_KEY"]
    context_id = os.environ.get("BROWSERBASE_CONTEXT_ID")
    if not context_id:
        async with AsyncBrowserbase(api_key=api_key) as bb:
            context = await bb.contexts.create()
            context_id = context.id
        print("Created Browserbase context:", context_id)
    browser = await browserbase.launch(
        api_key=api_key,
        timeout=300,
        browser_settings=BrowserbaseBrowserSettings(
            context={"id": context_id, "persist": True}
        ),
    )
    try:
        print(f"Session: https://www.browserbase.com/sessions/{browser.session_id}")
        stagehand = await Stagehand.create(
            browser=browser,
            model="openai/gpt-5.6-sol",
            model_api_key=os.environ["OPENAI_API_KEY"],
        )
        try:
            page = await browser.context.active_page()
            if page is None:
                raise RuntimeError("No active page")
            await page.goto("https://the-internet.herokuapp.com/secure", timeout=45_000)
            if not await page.wait_for_selector(
                'a[href="/logout"], input#username', timeout=15_000
            ):
                raise RuntimeError("Neither authenticated page nor login form is ready")
            reused = await page.locator('a[href="/logout"]').count() > 0
            if not reused:
                await page.goto(
                    "https://the-internet.herokuapp.com/login", timeout=45_000
                )
                for instruction, variables in [
                    (
                        "Type %username% into the username field",
                        {"username": os.environ["LOGIN_USER"]},
                    ),
                    (
                        "Type %password% into the password field",
                        {"password": os.environ["LOGIN_PASSWORD"]},
                    ),
                    ("Click the Login button", {}),
                ]:
                    result = await stagehand.act(
                        instruction, page=page, variables=variables
                    )
                    if not result.data.success:
                        raise RuntimeError("Login action failed; inspect the session")
                await page.goto(
                    "https://the-internet.herokuapp.com/secure", timeout=45_000
                )
            if not await page.locator('a[href="/logout"]').is_visible():
                raise RuntimeError("Authentication failed; no retry was attempted")
            output = Path("out/login.json")
            output.parent.mkdir(exist_ok=True)
            output.write_text(
                json.dumps(
                    {
                        "authenticated": True,
                        "reused": reused,
                        "sessionId": browser.session_id,
                    },
                    indent=2,
                )
                + "\n"
            )
            output.chmod(0o600)
            print(
                "Reused authenticated context"
                if reused
                else "Authenticated; context will persist when the browser closes"
            )
        finally:
            await stagehand.close()
    finally:
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
