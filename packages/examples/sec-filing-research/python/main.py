"""Extract recent Apple SEC filings with Stagehand V4."""

import asyncio
import json
import os

from dotenv import load_dotenv
from pydantic import BaseModel
from stagehand import Stagehand, browserbase

load_dotenv()

SEARCH_QUERY = "Apple Inc"
COMPANY_CIK = "0000320193"
NUM_FILINGS = 5


class CompanyInfo(BaseModel):
    company_name: str
    cik: str


class Filing(BaseModel):
    type: str
    date: str
    description: str | None
    accession_number: str | None
    file_number: str | None


class Filings(BaseModel):
    filings: list[Filing]


async def main() -> None:
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
                "https://www.sec.gov/edgar/searchedgar/companysearch.html",
                wait_until="domcontentloaded",
                timeout=60_000,
            )
            try:
                await stagehand.act(
                    "Click the Company and Person Lookup search textbox",
                    page=page,
                )
                await stagehand.act(
                    "Fill the company search field with %query%",
                    page=page,
                    variables={"query": SEARCH_QUERY},
                )
                await stagehand.act("Click the search submit button", page=page)
                await stagehand.act(
                    "Click the Apple Inc company result to view its filings",
                    page=page,
                )
            except Exception as error:
                print(
                    f"Semantic SEC navigation did not complete; checking its postcondition: {error}"
                )
            page = await browser.context.active_page() or page
            if "/edgar/browse/" not in await page.url():
                await page.goto(
                    f"https://www.sec.gov/edgar/browse/?CIK={COMPANY_CIK}&owner=exclude",
                    wait_until="domcontentloaded",
                    timeout=60_000,
                )
            company_result = await stagehand.extract(
                "Extract the official company name and numeric CIK from the page header",
                CompanyInfo,
                page=page,
            )
            filings_result = await stagehand.extract(
                (
                    f"Extract the {NUM_FILINGS} most recent SEC filings from the filings table. "
                    "For each return its type, filing date, description, accession number, and "
                    "file or film number when shown."
                ),
                Filings,
                page=page,
            )
            filings = filings_result.data.filings[:NUM_FILINGS]

            result = {
                "company": company_result.data.company_name,
                "cik": company_result.data.cik or COMPANY_CIK,
                "search_query": SEARCH_QUERY,
                "filings": [
                    {
                        **filing.model_dump(),
                        "description": filing.description or "",
                        "accession_number": filing.accession_number or "",
                        "file_number": filing.file_number or "",
                    }
                    for filing in filings
                ],
            }
            print(json.dumps(result, indent=2))
        finally:
            await stagehand.close()
    finally:
        await browser.close()
        print("Session closed successfully")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"SEC filing extraction failed: {error}")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        raise
