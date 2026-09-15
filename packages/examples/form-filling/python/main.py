"""Fill Browserbase's contact form with Stagehand V4."""

import asyncio
import os

from dotenv import load_dotenv

from stagehand import Stagehand, browserbase

load_dotenv()

FORM_FIELDS = {
    "firstName": "Alex",
    "lastName": "Johnson",
    "companyName": "TechCorp Solutions",
    "jobTitle": "Software Developer",
    "email": "alex.johnson@example.com",
    "project": (
        "Hello, I'm interested in learning more about your services and would "
        "like to schedule a demo."
    ),
}


async def main() -> None:
    api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not api_key:
        raise RuntimeError("BROWSERBASE_API_KEY is required")

    print("Starting Form Filling Example...")
    browser = await browserbase.launch(api_key=api_key)
    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        try:
            pages = await browser.context.pages()
            page = pages[0] if pages else await browser.context.new_page()

            print("Navigating to Browserbase contact page...")
            await page.goto(
                "https://www.browserbase.com/contact",
                wait_until="domcontentloaded",
                timeout=60_000,
            )
            await page.wait_for_timeout(1_500)

            field_prompts = {
                "firstName": "first name",
                "lastName": "last name",
                "companyName": "company",
                "jobTitle": "job title",
                "email": "work email",
                "project": "project description or message",
            }
            for name, label in field_prompts.items():
                await stagehand.act(
                    f"Fill the {label} field with %value%",
                    page=page,
                    variables={"value": FORM_FIELDS[name]},
                )

            await stagehand.act("Click the How Can We Help dropdown", page=page)
            await stagehand.act("Click the demo option in the open dropdown", page=page)

            # Uncomment to submit the form:
            # await stagehand.act("Click the submit button", page=page)
            print("Form filled successfully")
        finally:
            await stagehand.close()
    finally:
        await browser.close()
        print("Session closed successfully")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Error in form filling example: {error}")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        raise
