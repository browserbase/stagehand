import os
from urllib.parse import urlparse

from dotenv import load_dotenv
from stagehand import Stagehand, browserbase

load_dotenv()

BROWSERBASE_API_KEY = os.environ["BROWSERBASE_API_KEY"]
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")


def confirm_submit() -> bool:
    answer = input("Submit this form? [y/N] ").strip().lower()
    return answer == "y"


async def main() -> None:
    browser = await browserbase.launch(api_key=BROWSERBASE_API_KEY, timeout=300)
    try:
        print(f"Session: https://www.browserbase.com/sessions/{browser.session_id}")
        stagehand = await Stagehand.create(
            browser=browser,
            **(
                {"model": "openai/gpt-5.4-mini", "model_api_key": OPENAI_API_KEY}
                if OPENAI_API_KEY
                else {}
            ),
        )
        try:
            page = await browser.context.active_page()
            if page is None:
                raise RuntimeError("No active page")
            await page.goto("https://httpbin.org/forms/post")

            result = await stagehand.act(
                "Type %customer% into the customer name field",
                page=page,
                variables={"customer": "Ada Lovelace"},
            )
            if not result.data.success:
                raise RuntimeError(f"act() failed: {result.data.message}")
            result = await stagehand.act(
                "Type %email% into the email field",
                page=page,
                variables={"email": "ada@example.com"},
            )
            if not result.data.success:
                raise RuntimeError(f"act() failed: {result.data.message}")
            result = await stagehand.act("Select the medium size", page=page)
            if not result.data.success:
                raise RuntimeError(f"act() failed: {result.data.message}")
            result = await stagehand.act(
                "Type %comments% into the comments field",
                page=page,
                variables={"comments": "Leave at reception"},
            )
            if not result.data.success:
                raise RuntimeError(f"act() failed: {result.data.message}")

            expected = {
                "customer": "Ada Lovelace",
                "email": "ada@example.com",
                "size": "medium",
                "comments": "Leave at reception",
            }

            async def read_values() -> dict[str, str]:
                return {
                    "customer": await page.locator('[name="custname"]').input_value(),
                    "email": await page.locator('[name="custemail"]').input_value(),
                    "size": await page.locator('[name="size"]:checked').input_value(),
                    "comments": await page.locator('[name="comments"]').input_value(),
                }

            if await read_values() != expected:
                raise RuntimeError("Form values do not match the approval payload")
            print("Form values to submit:", expected)
            if not confirm_submit():
                print("Rejected: submit was not executed.")
                return

            if await read_values() != expected:
                raise RuntimeError("Form values changed after approval")
            result = await stagehand.act("Click the Submit order button", page=page)
            if not result.data.success:
                raise RuntimeError(f"act() failed: {result.data.message}")
            await page.wait_for_load_state("domcontentloaded")
            url = await page.url()
            if urlparse(url).netloc != "httpbin.org" or urlparse(url).path != "/post":
                raise RuntimeError(
                    "Submission destination was not verified; inspect before rerunning"
                )
            print({"submitted": True, "url": url})
        finally:
            await stagehand.close()
    finally:
        await browser.close()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
