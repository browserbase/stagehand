# Stagehand + Browserbase + Reducto: Download PDFs and Extract Financial Data

## AT A GLANCE

- **Goal**: Automate downloading financial PDFs from websites and extract structured data using AI-powered document parsing.
- **Pattern Template**: Demonstrates the integration pattern of Browserbase (download automation) + Reducto (document extraction).
- **Workflow**: Uses Stagehand `act()` and `extract()` to find Apple's FY2025 Q4 statement, Browserbase captures the PDF when opened, then Reducto extracts structured financial data with a schema.
- **Download Handling**: Implements retry logic with polling to handle Browserbase's async download sync (files sync to cloud storage in real-time).
- **Structured Extraction**: Uses Reducto's extract API with JSON schema to pull specific financial metrics from complex PDF tables.
- Docs → [Browserbase Downloads](https://docs.browserbase.com/features/downloads) | [Reducto Extract](https://docs.reducto.ai/parse/best-practices)

## GLOSSARY

- **act / extract**: navigate investor relations semantically and discover the intended statement URL
  Docs → https://docs.stagehand.dev/v4/basics/extract
- **Browserbase Downloads**: When a PDF URL is opened in a browser session, Browserbase automatically downloads and stores it in cloud storage. Files must be retrieved via the Session Downloads API as a ZIP archive.
  Docs → https://docs.browserbase.com/features/downloads
- **Reducto Extract**: Extract structured data from PDFs using JSON schema definitions. More efficient than parsing entire documents when you only need specific fields.
  Docs → https://docs.reducto.ai/extract
- **Schema-based extraction**: Define the exact structure you want extracted (fields, types, descriptions) and Reducto returns JSON matching your schema.
- **Download polling**: Browserbase syncs downloads in real-time; larger files may need retry logic to ensure availability via the API.

## QUICKSTART

1. cd browserbase-reducto
2. pnpm install
3. cp .env.example .env
4. Add required API keys to .env:
   - `BROWSERBASE_API_KEY`
   - `REDUCTOAI_API_KEY`
5. pnpm start

## EXPECTED OUTPUT

- Initializes Stagehand V4 with a Browserbase browser; Live View remains available in the Sessions dashboard
- Uses `act()` and `extract()` to find and validate the FY2025 Q4 PDF URL
- Opens the statement to trigger Browserbase PDF capture
- Browserbase automatically downloads PDF when link is opened
- Polls Browserbase Downloads API until file is ready (with retry logic)
- Extracts PDF from ZIP archive downloaded from Browserbase
- Uploads PDF to Reducto and extracts structured iPhone net sales data
- Outputs extracted financial data as formatted JSON
- Closes session cleanly

## NEXT STEPS

• **Parameterize extraction**: Accept different schema definitions or document types as configuration to extract various financial metrics or data structures.
• **Batch processing**: Process multiple quarters or companies by looping through different navigation paths and extracting data for each.
• **Multi-document support**: Handle ZIP archives with multiple PDFs and extract data from each, aggregating results into a unified dataset.
• **Optimize extraction**: Use Reducto's agentic mode selectively (only for complex tables or low-quality scans) to reduce latency and credit usage. Enable `scope: "table"` only when tables are misaligned or have merged cells.
Docs → https://docs.reducto.ai/parse/best-practices#2-enable-agentic-mode-only-when-needed

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
📚 Browserbase Downloads: https://docs.browserbase.com/features/downloads
📚 Reducto Best Practices: https://docs.reducto.ai/parse/best-practices
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
