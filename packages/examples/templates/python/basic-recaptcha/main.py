"""Solve and verify Google's reCAPTCHA demo with Stagehand V4."""

import asyncio
import os

from dotenv import load_dotenv

from stagehand import Stagehand, browserbase

load_dotenv()


async def main() -> None:
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")

    browser = await browserbase.launch(
        api_key=api_key,
        browser_settings={"solve_captchas": True},
    )
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            await page.goto(
                "https://google.com/recaptcha/api2/demo",
                wait_until="domcontentloaded",
                timeout=60_000,
            )

            print("Waiting for Browserbase captcha solving...")
            token = ""
            for _ in range(60):
                token = await page.locator("#g-recaptcha-response").input_value()
                if token:
                    break
                await asyncio.sleep(1)
            if not token:
                raise RuntimeError("Captcha token was not populated within 60 seconds")

            await stagehand.act("Click the Submit button", page=page)
            extracted = await stagehand.extract("Extract all text on this page", page=page)
            text = extracted.data.extraction
            print("Page content after submission:")
            print(text)
        finally:
            await stagehand.close()
    finally:
        await browser.close()
        print("Session closed successfully")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"reCAPTCHA example failed: {error}")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        raise
