"""Download Apple's FY2025 statements with Stagehand V4."""

import asyncio
import json
import os
import time
from pathlib import Path

from browserbase import Browserbase
from dotenv import load_dotenv
from pydantic import BaseModel, HttpUrl

from stagehand import Stagehand, browserbase

load_dotenv()


class StatementLinks(BaseModel):
    statement_urls: list[HttpUrl]


async def save_downloads_with_retry(
    client: Browserbase,
    session_id: str,
    retry_for_seconds: int = 45,
) -> int:
    started = time.monotonic()
    while time.monotonic() - started < retry_for_seconds:
        response = await asyncio.to_thread(client.sessions.downloads.list, session_id)
        payload = await asyncio.to_thread(response.read)
        if payload:
            Path("downloaded_files.zip").write_bytes(payload)
            print(f"Saved downloaded_files.zip ({len(payload)} bytes)")
            return len(payload)
        await asyncio.sleep(2)
    raise TimeoutError("Download timeout exceeded")


async def main() -> None:
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")

    print("Starting Apple Financial Statements Download Automation...")
    api = Browserbase(api_key=api_key)
    browser = await browserbase.launch(api_key=api_key)
    session_id = browser.session_id
    if not session_id:
        await browser.close()
        raise RuntimeError("Browserbase launch did not return a session ID")

    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()
            await page.goto("https://www.apple.com/", wait_until="domcontentloaded", timeout=60_000)
            await stagehand.act(
                "Click the Investors button at the bottom of the page",
                page=page,
            )
            await stagehand.act(
                "Scroll down to the Financial Data section",
                page=page,
            )
            await stagehand.act(
                "Under Quarterly Earnings Reports, click 2025",
                page=page,
            )
            page = await browser.context.active_page() or page
            extracted = await stagehand.extract(
                (
                    "Extract the actual absolute HTTP(S) href URLs of the four FY2025 Financial "
                    "Statements PDF links, ordered Q4 through Q1."
                ),
                StatementLinks,
                page=page,
            )
            statement_urls = [str(url) for url in extracted.data.statement_urls[:4]]
            for index, statement_url in enumerate(statement_urls):
                opened = await stagehand.act(
                    f"Click the Financial Statements link under Q{4 - index}",
                    page=page,
                )
                if not opened.data.success:
                    encoded_url = json.dumps(statement_url)
                    await page.evaluate(
                        f"""(() => {{
                          const link = document.createElement('a');
                          link.href = {encoded_url};
                          link.target = '_blank';
                          document.body.appendChild(link);
                          link.click();
                          link.remove();
                        }})()"""
                    )
                await page.wait_for_timeout(500)
                print(f"Triggered FY2025 Q{4 - index} download")

            await save_downloads_with_retry(api, session_id)
            print("Downloads completed")
        finally:
            await stagehand.close()
    finally:
        await browser.close()
        print("Session closed successfully")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Application error: {error}")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        raise
