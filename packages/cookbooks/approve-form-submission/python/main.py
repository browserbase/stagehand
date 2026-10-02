import os
from dotenv import load_dotenv
from stagehand import Stagehand, browserbase

load_dotenv()

BROWSERBASE_API_KEY = os.environ["BROWSERBASE_API_KEY"]
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]


def confirm_submit() -> bool:
    answer = input("Submit this form? [y/N] ").strip().lower()
    return answer == "y"


async def main() -> None:
    browser = await browserbase.launch(api_key=BROWSERBASE_API_KEY)
    try:
        stagehand = await Stagehand.create(
            browser=browser,
            model="openai/gpt-5.4-mini",
            model_api_key=OPENAI_API_KEY,
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

            print("Form is filled. Submit is the side-effecting click.")
            if not confirm_submit():
                print("Rejected: submit was not executed.")
                return

            result = await stagehand.act("Click the Submit order button", page=page)
            if not result.data.success:
                raise RuntimeError(f"act() failed: {result.data.message}")
            await page.wait_for_load_state("domcontentloaded")
            print({"submitted": True, "url": await page.url()})
        finally:
            await stagehand.close()
    finally:
        await browser.close()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
