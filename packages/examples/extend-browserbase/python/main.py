# Stagehand + Browserbase + Extend: Download Expense Receipts and Parse with Extend AI
# See README.md for full documentation

import asyncio
import csv
import json
import os
import zipfile
from pathlib import Path

from browserbase import APIStatusError, Browserbase
from dotenv import load_dotenv
from extend_ai import Extend
from stagehand import Stagehand, browserbase

# Load environment variables from .env file
# Required: BROWSERBASE_API_KEY
# Optional: EXTEND_API_KEY
load_dotenv()


# Receipt extraction config for Extend AI
# Uses extraction_light base extractor with parse_performance engine for low latency
RECEIPT_EXTRACTION_CONFIG = {
    "baseProcessor": "extraction_light",
    "baseVersion": "3.4.0",
    "parseConfig": {
        "engine": "parse_performance",
        "target": "markdown",
        "blockOptions": {
            "text": {
                "agentic": {"enabled": False},
                "signatureDetectionEnabled": False,
            },
            "tables": {
                "agentic": {"enabled": False},
                "targetFormat": "markdown",
                "cellBlocksEnabled": False,
                "tableHeaderContinuationEnabled": False,
            },
            "figures": {
                "enabled": False,
                "figureImageClippingEnabled": False,
            },
        },
        "engineVersion": "1.0.1",
        "advancedOptions": {
            "engine": "parse_performance",
            "agenticOcrEnabled": False,
            "pageBreaksEnabled": True,
            "pageRotationEnabled": False,
            "verticalGroupingThreshold": 1,
        },
        "chunkingStrategy": {"type": "document"},
    },
    "schema": {
        "type": "object",
        "required": [
            "vendor_name",
            "receipt_date",
            "receipt_number",
            "total_amount",
            "subtotal_amount",
            "tax_amount",
            "line_items",
            "payment_method",
        ],
        "properties": {
            "vendor_name": {
                "type": ["string", "null"],
                "description": "The name of the merchant or vendor on the receipt.",
            },
            "receipt_date": {
                "type": ["string", "null"],
                "description": "The date of the transaction shown on the receipt.",
                "extend:type": "date",
            },
            "receipt_number": {
                "type": ["string", "null"],
                "description": "The receipt or transaction number, if present.",
            },
            "total_amount": {
                "type": "object",
                "required": ["amount", "iso_4217_currency_code"],
                "properties": {
                    "amount": {"type": ["number", "null"]},
                    "iso_4217_currency_code": {"type": ["string", "null"]},
                },
                "description": "The total amount paid on the receipt.",
                "extend:type": "currency",
                "additionalProperties": False,
            },
            "subtotal_amount": {
                "type": "object",
                "required": ["amount", "iso_4217_currency_code"],
                "properties": {
                    "amount": {"type": ["number", "null"]},
                    "iso_4217_currency_code": {"type": ["string", "null"]},
                },
                "description": "The subtotal before tax, if shown.",
                "extend:type": "currency",
                "additionalProperties": False,
            },
            "tax_amount": {
                "type": "object",
                "required": ["amount", "iso_4217_currency_code"],
                "properties": {
                    "amount": {"type": ["number", "null"]},
                    "iso_4217_currency_code": {"type": ["string", "null"]},
                },
                "description": "The tax amount on the receipt.",
                "extend:type": "currency",
                "additionalProperties": False,
            },
            "line_items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "required": ["description", "quantity", "unit_price", "amount"],
                    "properties": {
                        "description": {
                            "type": ["string", "null"],
                            "description": "Description of the item purchased.",
                        },
                        "quantity": {
                            "type": ["number", "null"],
                            "description": "Quantity of the item, if shown.",
                        },
                        "unit_price": {
                            "type": ["number", "null"],
                            "description": "Price per unit, if shown.",
                        },
                        "amount": {
                            "type": ["number", "null"],
                            "description": "Total amount for this line item.",
                        },
                    },
                    "additionalProperties": False,
                },
                "description": "Individual items on the receipt.",
            },
            "payment_method": {
                "type": ["string", "null"],
                "description": "The payment method used (e.g., cash, credit card, etc.).",
            },
        },
        "additionalProperties": False,
    },
    "advancedOptions": {
        "advancedMultimodalEnabled": False,
        "citationsEnabled": True,
        "arrayCitationStrategy": "item",
        "pageRanges": [],
        "chunkingOptions": {},
        "advancedFigureParsingEnabled": True,
    },
}


# Polls Browserbase API for completed downloads with retry logic
async def save_downloads_with_retry(
    bb: Browserbase, session_id: str, retry_for_seconds: int = 60
) -> int:
    """
    Polls Browserbase API for downloads with timeout handling.

    Browserbase stores downloaded files during a session and makes them available
    via API. Files may take a few seconds to process, so this function implements
    retry logic to wait for downloads to be ready before retrieving them.

    Args:
        bb: Browserbase client instance for API calls
        session_id: The Browserbase session ID to retrieve downloads from
        retry_for_seconds: Maximum time to wait for downloads (default: 60 seconds)

    Returns:
        int: The size of the downloaded ZIP file in bytes

    Raises:
        TimeoutError: If downloads aren't ready within the specified timeout
    """
    print(f"Waiting up to {retry_for_seconds} seconds for downloads to complete...")

    # Track elapsed time to implement timeout without using threading timers
    start_time = asyncio.get_event_loop().time()
    timeout = retry_for_seconds

    while True:
        elapsed = asyncio.get_event_loop().time() - start_time

        # Check if we've exceeded the timeout period
        if elapsed >= timeout:
            raise TimeoutError("Download timeout exceeded")

        try:
            print("Checking for downloads...")
            # Fetch downloads from Browserbase API and save to disk when ready
            # Use asyncio.to_thread for synchronous Browserbase SDK calls
            # This prevents blocking the event loop while waiting for API responses
            response = await asyncio.to_thread(bb.sessions.downloads.list, session_id)
            download_buffer = await asyncio.to_thread(response.read)

            # Save downloads to disk when file size indicates content is available
            # Empty zip files are ~22 bytes, so require at least 100 bytes for real content
            if len(download_buffer) > 100:
                print(f"Downloads ready! File size: {len(download_buffer)} bytes")
                # Save the ZIP file containing all downloaded receipts to disk
                with open("downloaded_files.zip", "wb") as f:
                    f.write(download_buffer)
                print("Files saved as: downloaded_files.zip")
                return len(download_buffer)
            else:
                print("Downloads not ready yet, retrying...")
        except APIStatusError as e:
            # Handle 404 (session not found) gracefully
            if e.status_code == 404:
                print("Session not found, returning empty result")
                return 0
            print(f"Error fetching downloads: {e}")
            raise
        except Exception as e:
            # HTML error response - session may not be ready yet, keep retrying
            error_message = str(e)
            if "Unexpected token '<'" in error_message or "<html" in error_message:
                print("Session not ready yet, retrying...")
                await asyncio.sleep(2)
                continue
            print(f"Error fetching downloads: {e}")
            raise

        # Poll every 2 seconds to check if downloads are ready
        await asyncio.sleep(2)


# Extracts receipt files from downloaded zip archive into output directories
def extract_files_from_zip(zip_path: str, output_dir: str = "output/documents") -> list[str]:
    """
    Extract receipt files from a ZIP archive.

    Args:
        zip_path: Path to the ZIP file containing receipts
        output_dir: Directory to extract files to (default: "output/documents")

    Returns:
        list[str]: Paths to all extracted files

    Raises:
        ValueError: If no files are found in the ZIP
    """
    print(f"Extracting files from {zip_path}...")

    # Create output directories for documents and results if they don't exist
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    Path("output/results").mkdir(parents=True, exist_ok=True)

    extracted_files: list[str] = []

    with zipfile.ZipFile(zip_path, "r") as zip_ref:
        # Open zip file and iterate over entries
        entries = [e for e in zip_ref.namelist() if not e.endswith("/")]

        if len(entries) == 0:
            raise ValueError("No files found in the downloaded zip")

        # Extract all non-directory entries and collect file paths
        resolved_output = output_path.resolve()
        for entry in entries:
            extracted_path = (resolved_output / entry).resolve()
            if resolved_output not in extracted_path.parents:
                raise ValueError(f"Unsafe ZIP entry: {entry}")
            extracted_path.parent.mkdir(parents=True, exist_ok=True)
            with zip_ref.open(entry) as source, extracted_path.open("wb") as target:
                target.write(source.read())
            print(f"Extracted: {extracted_path}")
            extracted_files.append(str(extracted_path))

    print(f"\nTotal files extracted: {len(extracted_files)}")
    return extracted_files


# Uploads receipt files to Extend AI, runs extraction, and saves results as JSON and CSV
async def parse_receipts_with_extend(file_paths: list[str]) -> list[dict]:
    """
    Upload receipt files to Extend AI, run extraction, and save results.

    Initializes the Extend client, uploads each file, runs synchronous extraction
    using inline config (no need to pre-create an extractor resource), and saves
    results as JSON and CSV.

    Args:
        file_paths: List of file paths to receipt documents
    """
    # Skip parsing if Extend API key is not configured
    extend_api_key = os.environ.get("EXTEND_API_KEY")
    if not extend_api_key or extend_api_key == "YOUR_EXTEND_API_KEY_HERE":
        print("\nWARNING: EXTEND_API_KEY not configured. Skipping receipt parsing.")
        print("   Add your Extend API key to .env to enable automatic receipt parsing.")
        return []

    print("\n=== Parsing Receipts with Extend AI ===\n")

    # Initialize Extend AI client
    extend_client = Extend(token=extend_api_key)

    print(f"Processing {len(file_paths)} receipts with inline config...\n")

    # Process all files with retry on rate limiting (429 errors)
    results: list[dict] = []

    # Uploads a single file to Extend and runs extraction with exponential backoff retry
    async def process_with_retry(file_path: str, max_retries: int = 3) -> dict:
        file_name = Path(file_path).name

        for attempt in range(1, max_retries + 1):
            try:
                # Upload the file to Extend (multipart form upload)
                # Pass as (filename, bytes) tuple so Extend knows the file name
                with open(file_path, "rb") as f:
                    file_bytes = f.read()
                upload_response = await asyncio.to_thread(
                    extend_client.files.upload,
                    file=(file_name, file_bytes),
                )
                file_id = upload_response.id

                # Run extraction using inline config — no need to pre-create an extractor
                result = await asyncio.to_thread(
                    extend_client.extract,
                    config=RECEIPT_EXTRACTION_CONFIG,
                    file={"id": file_id},
                )

                run_id = result.id
                print(f"  Parsed {file_name} (run: {run_id})")

                # Convert to dict for JSON serialization
                data = result
                if hasattr(result, "to_dict"):
                    data = result.to_dict()
                elif hasattr(result, "dict"):
                    data = result.dict()

                return {
                    "file": file_name,
                    "runId": run_id,
                    "data": data,
                }
            except Exception as error:
                error_msg = str(error)
                is_retryable = (
                    "429" in error_msg or "rate" in error_msg or "disturbed or locked" in error_msg
                )

                if is_retryable and attempt < max_retries:
                    delay = 2**attempt  # Exponential backoff: 2s, 4s, 8s
                    print(
                        f"  Rate limited on {file_name}, retrying in {delay}s "
                        f"(attempt {attempt}/{max_retries})"
                    )
                    await asyncio.sleep(delay)
                else:
                    print(f"  Failed to parse {file_name}: {error_msg}")
                    return {"file": file_name, "data": {"error": error_msg}}

        return {"file": file_name, "data": {"error": "Max retries exceeded"}}

    # Process in batches of 9 to balance speed and reliability
    for i in range(0, len(file_paths), 9):
        batch = file_paths[i : i + 9]
        batch_results = await asyncio.gather(*[process_with_retry(fp) for fp in batch])
        results.extend(batch_results)

    # Save results to JSON
    json_path = "output/results/receipts.json"
    with open(json_path, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nSaved JSON: {json_path}")

    # Convert results to CSV for easy viewing in spreadsheet tools
    csv_path = "output/results/receipts.csv"
    with open(csv_path, "w", newline="") as f:
        writer = csv.writer(f, quoting=csv.QUOTE_ALL)
        writer.writerow(
            [
                "file",
                "vendor_name",
                "receipt_date",
                "receipt_number",
                "total_amount",
                "currency",
                "subtotal",
                "tax",
                "payment_method",
                "line_items_count",
            ]
        )

        # Build CSV rows from extraction results
        for result in results:
            data = result.get("data", {})
            output = {}
            if isinstance(data, dict):
                output = data.get("output", {}).get("value", {}) or {}

            writer.writerow(
                [
                    result.get("file", ""),
                    output.get("vendor_name", ""),
                    output.get("receipt_date", ""),
                    output.get("receipt_number", ""),
                    (output.get("total_amount") or {}).get("amount", ""),
                    (output.get("total_amount") or {}).get("iso_4217_currency_code", ""),
                    (output.get("subtotal_amount") or {}).get("amount", ""),
                    (output.get("tax_amount") or {}).get("amount", ""),
                    output.get("payment_method", ""),
                    len(output.get("line_items", []))
                    if isinstance(output.get("line_items"), list)
                    else 0,
                ]
            )

    print(f"Saved CSV:  {csv_path}")
    return results


async def main() -> None:
    """
    Main application entry point.

    Orchestrates the entire receipt download and extraction automation process:
    1. Initializes Browserbase and Stagehand clients
    2. Navigates to the expense portal
    3. Finds and clicks all individual receipt download buttons
    4. Retrieves downloads from Browserbase and extracts files
    5. Optionally parses receipts with Extend AI for structured data extraction
    """
    print("Starting Expense Receipt Downloader...\n")

    browserbase_api_key = os.environ.get("BROWSERBASE_API_KEY")
    if not browserbase_api_key:
        raise ValueError("BROWSERBASE_API_KEY is required")

    # Initialize Browserbase SDK for session management and download retrieval
    bb = Browserbase(api_key=browserbase_api_key)

    browser = await browserbase.launch(api_key=browserbase_api_key)
    session_id = browser.session_id
    if not session_id:
        await browser.close()
        raise RuntimeError("Browserbase launch did not return a session ID")

    try:
        stagehand = await Stagehand.create(
            browser=browser,
        )
        pages = await browser.context.pages()
        page = pages[0] if pages else await browser.context.new_page()
        print("Live View is available in the Browserbase Sessions dashboard")

        # Navigate to the expense portal where receipts are hosted
        print("\nNavigating to expense portal...")
        await page.goto(
            "https://v0-reimburse-me-expense-portal.vercel.app/",
            wait_until="domcontentloaded",
            timeout=60_000,
        )

        # Use observe to find all individual download buttons (not the Download All button)
        print("\nFinding all individual download buttons...")
        observe_response = await stagehand.observe(
            "Find all the small Download links on individual receipt cards.",
            page=page,
        )
        download_buttons = observe_response.data
        if not download_buttons:
            raise RuntimeError("No receipt download links were found")

        # Click each download button using observe -> act pattern
        # Pass the observed action directly to act for precise element targeting
        success_count = 0
        for i, action in enumerate(download_buttons):
            print(f"Downloading receipt {i + 1}/{len(download_buttons)}...")

            try:
                await stagehand.act(action, page=page)
                success_count += 1
            except Exception:
                # If click fails, scroll element into view and retry
                print(f"  Could not click download button {i + 1}, trying to scroll and retry...")
                try:
                    await stagehand.act("Scroll down slightly", page=page)
                    await stagehand.act(action, page=page)
                    success_count += 1
                except Exception:
                    print(f"  Skipping receipt {i + 1}")

            # Scroll down periodically to ensure elements are in view
            if (i + 1) % 4 == 0 and (i + 1) < len(download_buttons):
                await stagehand.act("Scroll down slightly", page=page)

        print(f"\nDownload clicks completed! ({success_count}/{len(download_buttons)} successful)")

        await stagehand.close()
        await browser.close()
        print("Session closed successfully")

        # Wait for session to finalize downloads before polling
        await asyncio.sleep(2)

        # Retrieve all downloads triggered during this session from Browserbase API
        print("\nRetrieving downloads from Browserbase...")
        download_size = await save_downloads_with_retry(bb, session_id, 60)

        if download_size > 0:
            # Extract receipt files from downloaded zip archive
            extracted_files = extract_files_from_zip("downloaded_files.zip")

            print("\n=== Download Summary ===")
            print(f"Total files downloaded: {len(extracted_files)}")
            print("Files saved to: ./output/documents/")

            # Parse downloaded receipts with Extend AI for structured data extraction
            await parse_receipts_with_extend(extracted_files)
        else:
            print("No downloads were captured")

        print("\nExpense receipt download complete!")

    except Exception as error:
        print(f"Error during automation: {error}")
        if "stagehand" in locals():
            await stagehand.close()
        await browser.close()
        raise


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as err:
        print(f"Application error: {err}")
        print("Common issues:")
        print("  - Check .env file has BROWSERBASE_API_KEY")
        print("  - Add EXTEND_API_KEY to .env to enable receipt parsing with Extend AI")
        print("  - Verify internet connection and expense portal accessibility")
        print("Docs: https://docs.stagehand.dev/v4/first-steps/introduction")
        exit(1)
