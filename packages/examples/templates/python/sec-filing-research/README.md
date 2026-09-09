# Stagehand + Browserbase: SEC Filing Research

Stagehand is the SDK for browser agents.

## AT A GLANCE

- Goal: automate searching SEC EDGAR for a company and extracting recent filing metadata (type, date, description, accession number, file number).
- Search: supports company name, ticker symbol, or CIK number (e.g. "Apple Inc", "AAPL", "0000320193").
- Data Extraction: uses Stagehand act/extract with Pydantic schemas to navigate SEC.gov and pull structured filing data.
- Output: company name, CIK, and a configurable number of most recent filings, printed as summary and JSON.

## GLOSSARY

- act: perform UI actions from a natural language prompt (click, type, submit).
  Docs → https://docs.stagehand.dev/v4/basics/act
- extract: pull structured data from web pages into validated objects using a JSON schema.
  Docs → https://docs.stagehand.dev/v4/basics/extract
- schema: JSON schema definition for filing and company info; enforces types and validation.
- SEC EDGAR: SEC’s company and filing search and filing system.
  https://www.sec.gov/edgar/searchedgar/companysearch.html
- CIK: Central Index Key — unique numeric identifier for each company in EDGAR.

## QUICKSTART

1. cd python/sec-filing-research
2. Install dependencies with uv:

   ```bash
   uv sync
   ```

   Or with pip in a venv:

   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -e .
   ```

3. cp .env.example .env
4. Add BROWSERBASE_API_KEY to .env
5. (Optional) Edit SEARCH_QUERY and NUM_FILINGS in main.py
6. Run the script:

   ```bash
   python main.py
   ```

   Or with uv:

   ```bash
   uv run python main.py
   ```

## EXPECTED OUTPUT

- Initializes Stagehand session with Browserbase and shows live view URL
- Navigates to SEC EDGAR company search
- Enters search query, submits, and selects the matching company
- Extracts company name and CIK from the filings page
- Extracts the N most recent filings (type, date, description, accession number, file number)
- Logs SEC FILING METADATA summary and per-filing details
- Outputs full result as JSON
- Closes session cleanly

## COMMON PITFALLS

- "ModuleNotFoundError": run `uv sync` or `pip install -e .` in sec-filing-research
- Missing credentials: ensure .env has BROWSERBASE_API_KEY
- No company match: use a valid company name, ticker, or CIK; SEC search is case-sensitive for some queries
- Extraction errors: if SEC changes its UI, inspect the session and adjust the act/extract prompts
- Rate limiting: avoid excessive runs; SEC may throttle heavy or automated traffic

## USE CASES

• Compliance and due diligence: quickly pull recent 10-K, 10-Q, 8-K metadata for a list of companies.
• Research pipelines: feed accession numbers into downstream tools to fetch full filings or parse specific sections.
• Monitoring: periodically extract latest filings for watchlists and alert on new filings.
• Data enrichment: attach official company name and CIK to internal records using SEC as source of truth.

## NEXT STEPS

• Parameterize search: read SEARCH_QUERY and NUM_FILINGS from env or CLI for batch runs.
• Fetch full filings: use accession numbers with SEC’s full-text filing URLs or APIs to download documents.
• Multiple companies: loop over a list of tickers/names and aggregate results into a single report or JSON.
• Filter by type: restrict to 10-K/10-Q/8-K or other form types in the extract step or in post-processing.

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
