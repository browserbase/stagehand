"""Download Apple's FY2025 Q4 statement and extract sales with Reducto."""

import asyncio
import json
import os
import time
import zipfile
from pathlib import Path
from typing import Any

from browserbase import AsyncBrowserbase
from dotenv import load_dotenv
from pydantic import BaseModel, HttpUrl
from reducto import Reducto
from stagehand import Stagehand, browserbase

load_dotenv()


class StatementLink(BaseModel):
    statement_url: HttpUrl


async def save_downloads_with_retry(
    client: AsyncBrowserbase,
    session_id: str,
    retry_for_seconds: int = 60,
) -> int:
    started = time.monotonic()
    while time.monotonic() - started < retry_for_seconds:
        response = await client.sessions.downloads.list(session_id)
        payload = await response.read()
        if len(payload) > 100:
            Path("downloaded_files.zip").write_bytes(payload)
            print(f"Saved downloaded_files.zip ({len(payload)} bytes)")
            return len(payload)
        await asyncio.sleep(2)
    raise TimeoutError("Download timeout exceeded")


def extract_pdf_from_zip(
    zip_path: str,
    output_dir: str = "downloaded_files",
) -> Path:
    destination = Path(output_dir).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    first_pdf: Path | None = None

    with zipfile.ZipFile(zip_path) as archive:
        entries = [name for name in archive.namelist() if not name.endswith("/")]
        for entry in entries:
            with archive.open(entry) as source:
                payload = source.read()
            if not payload.startswith(b"%PDF"):
                continue
            output_name = entry if entry.lower().endswith(".pdf") else f"{entry}.pdf"
            output = (destination / output_name).resolve()
            if destination not in output.parents:
                raise RuntimeError(f"Unsafe ZIP entry: {entry}")
            output.parent.mkdir(parents=True, exist_ok=True)
            with output.open("wb") as target:
                target.write(payload)
            first_pdf = first_pdf or output

    if first_pdf is None:
        raise RuntimeError("Failed to extract a PDF")
    return first_pdf


async def extract_pdf_with_reducto(pdf_path: Path, reducto_client: Reducto) -> dict[str, Any]:
    upload = await asyncio.to_thread(reducto_client.upload, file=pdf_path)
    print("Uploaded statement to Reducto")
    schema = {
        "type": "object",
        "properties": {
            "iphone_net_sales": {
                "type": "object",
                "properties": {
                    "current_quarter": {"type": "number"},
                    "previous_quarter": {"type": "number"},
                    "current_year": {"type": "number"},
                    "previous_year": {"type": "number"},
                    "current_quarter_date": {"type": "string"},
                    "previous_quarter_date": {"type": "string"},
                },
                "required": [
                    "current_quarter",
                    "previous_quarter",
                    "current_year",
                    "previous_year",
                    "current_quarter_date",
                    "previous_quarter_date",
                ],
            }
        },
        "required": ["iphone_net_sales"],
    }
    response = await asyncio.to_thread(
        reducto_client.extract.run,
        input=upload,
        instructions={
            "schema": schema,
            "system_prompt": (
                "Extract the iPhone net sales values from the net sales by "
                "reportable segment table in this financial statement."
            ),
        },
        settings={
            "optimize_for_latency": True,
            "citations": {"numerical_confidence": False},
        },
    )

    extracted: Any = getattr(response, "result", response)
    if isinstance(extracted, list):
        extracted = extracted[0] if extracted else None
    if hasattr(extracted, "model_dump"):
        extracted = extracted.model_dump(mode="json")
    return extracted


async def main() -> None:
    browserbase_key = os.environ.get("BROWSERBASE_API_KEY")
    reducto_key = os.environ.get("REDUCTOAI_API_KEY")
    if not browserbase_key or not reducto_key:
        raise RuntimeError("BROWSERBASE_API_KEY and REDUCTOAI_API_KEY are required")

    api = AsyncBrowserbase(api_key=browserbase_key)
    reducto = Reducto(api_key=reducto_key)
    browser = await browserbase.launch(api_key=browserbase_key)
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
                    "Extract the actual absolute HTTP(S) href URL of the FY2025 Q4 Financial "
                    "Statements PDF."
                ),
                StatementLink,
                page=page,
            )
            statement_url = str(extracted.data.statement_url)

            opened_statement = await stagehand.act(
                "Click the Financial Statements link under Q4",
                page=page,
            )
            if not opened_statement.data.success:
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
            print("Triggered FY2025 Q4 statement download")
            await save_downloads_with_retry(api, session_id)
            pdf_path = extract_pdf_from_zip("downloaded_files.zip")
            extracted = await extract_pdf_with_reducto(pdf_path, reducto)
            print(json.dumps(extracted, indent=2))
        finally:
            await stagehand.close()
    finally:
        await browser.close()
        await api.close()
        print("Session closed successfully")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(f"Application error: {error}")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        raise
