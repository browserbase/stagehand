# Stagehand + Browserbase + Extend: Download Expense Receipts and Parse with Extend AI

## AT A GLANCE

- **Goal**: Automate downloading receipts from an expense portal and extract structured receipt data using AI-powered document parsing.
- **Pattern Template**: Demonstrates the integration pattern of Browserbase (browser automation + download capture) + Extend AI (schema-based document extraction).
- **Workflow**: Stagehand navigates the expense portal and clicks each receipt's download link; Browserbase captures downloads. The script polls for the session's download ZIP, extracts files, then optionally sends them to Extend for structured extraction (vendor, date, totals, line items, etc.).
- **Download Handling**: Implements retry/polling around Browserbase's Session Downloads API until the ZIP is available.
- **Structured Extraction**: Extend AI extraction with inline receipt JSON schema config; results written to `output/results/receipts.json` and `receipts.csv`.
- Docs → [Browserbase Downloads](https://docs.browserbase.com/features/downloads) | [Extend AI](https://docs.extend.app)

## GLOSSARY

- **act**: perform UI actions from natural language prompts (click, scroll, navigate)
  Docs → https://docs.stagehand.dev/v4/basics/act
- **observe**: find and return interactive elements on the page matching a description, without performing actions. Used here to locate all individual download buttons before clicking them.
  Docs → https://docs.stagehand.dev/v4/basics/observe
- **Browserbase Downloads**: When files are downloaded during a browser session, Browserbase captures and stores them. Files are retrieved via the Session Downloads API as a ZIP archive.
  Docs → https://docs.browserbase.com/features/downloads
- **Extend AI extraction**: A configurable document extraction pipeline that parses files against a JSON schema and returns structured data. Config can be passed inline or via a saved extractor resource.
  Docs → https://docs.extend.app
- **Download polling**: Browserbase syncs downloads in real-time; the script retries every 2 seconds until the ZIP is available or a timeout is reached.

## QUICKSTART

1. cd typescript/extend-browserbase
2. pnpm install
3. cp .env.example .env
4. Add required API keys to .env:
   - `BROWSERBASE_API_KEY`
   - `EXTEND_API_KEY` (optional — enables receipt parsing)
5. pnpm start

## EXPECTED OUTPUT

- Initializes Stagehand V4 with Browserbase; Live View remains available in the Sessions dashboard
- Navigates to the expense portal and finds all per-receipt download links via observe
- Clicks each download button; Browserbase captures files
- After closing the session, polls for the session's download ZIP and extracts to `output/documents/`
- If `EXTEND_API_KEY` is set: uploads each file to Extend and runs extraction with inline config, writes `output/results/receipts.json` and `receipts.csv`
- Closes session cleanly

## COMMON PITFALLS

- "Cannot find module": ensure pnpm install completed in the extend-browserbase directory
- Missing credentials: verify .env contains BROWSERBASE_API_KEY
- Download timeout: increase `retryForSeconds` parameter in `saveDownloadsWithRetry` if downloads take longer than 60 seconds
- Empty ZIP file: ensure downloads were actually triggered (inspect the session in the Browserbase dashboard)
- Rate limiting on Extend: the script retries with exponential backoff on 429 errors, but very large batches may need the batch size reduced from 9
- Find more information on your Browserbase dashboard → https://www.browserbase.com/sign-in

## USE CASES

• Expense automation: Download receipts from expense portals and extract vendor, date, totals, and line items for accounting systems.
• Document batch processing: Collect files from web portals and run structured extraction across all of them with a single script.
• Receipt digitization: Convert paper/PDF receipts into structured JSON and CSV for import into ERP, bookkeeping, or reimbursement tools.

## NEXT STEPS

• Parameterize the portal URL: Accept the expense portal URL from env or CLI to support different receipt sources.
• Custom schemas: Modify `receiptExtractionConfig` to extract different document types (invoices, W-2s, contracts) by changing the JSON schema.
• Add validation: Compare extracted totals against line item sums to flag discrepancies or incomplete extractions.
• Scheduled runs: Deploy on cron/Lambda to periodically check for new receipts and process them automatically.

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
📚 Browserbase Downloads: https://docs.browserbase.com/features/downloads
📚 Extend AI: https://docs.extend.app
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
