# Stagehand + Browserbase: Amazon Product Scraping

Stagehand is the SDK for browser agents.

## AT A GLANCE

- **Goal**: Scrape the first 3 Amazon search results for a given query and return structured product data.
- **AI-Powered Search**: Uses Stagehand `act` to type in the search bar and click search (or optionally navigate directly to the search URL).
- **Structured Extraction**: Uses `extract` with a JSON schema to get product name, price, rating, review count, and product URL.
- **Model**: Uses `google/gemini-2.5-flash` for fast, cost-effective automation.
- Docs → https://docs.stagehand.dev

## GLOSSARY

- **act**: Perform UI actions from a prompt (type in search bar, click search).
  Docs → https://docs.stagehand.dev/v4/basics/act
- **extract**: Pull structured data from pages using JSON schemas.
  Docs → https://docs.stagehand.dev/v4/basics/extract

## QUICKSTART

1. cd python/amazon-product-scraping
2. cp .env.example .env (or create .env with required keys)
3. Add `BROWSERBASE_API_KEY` to .env
4. Optionally edit `SEARCH_QUERY` in main.py
5. Run the script:
   ```bash
   uv run python main.py
   ```

## EXPECTED OUTPUT

- Initializes Stagehand session with Browserbase
- Displays live session link for monitoring
- Navigates to Amazon and performs search (or direct URL navigation if uncommented)
- Extracts the first 3 products with name, price, rating, reviews count, and product URL
- Outputs JSON to console
- Closes session cleanly

## COMMON PITFALLS

- **Import errors**: Ensure you're running with `uv run python main.py` so dependencies are installed
- **Missing credentials**: Verify .env contains `BROWSERBASE_API_KEY`
- **Amazon layout changes**: Extraction may need prompt/schema updates if Amazon changes their search results UI
- Find more information on your Browserbase dashboard → https://www.browserbase.com/sign-in

## USE CASES

• **Price monitoring**: Scrape top results for a product query to track prices and availability over time.
• **Competitor research**: Extract product titles, ratings, and review counts for comparison.
• **Catalog building**: Pull structured product data for feeds, dashboards, or internal tools.

## NEXT STEPS

• **Switch to direct URL**: Uncomment the URL-based search block in main.py for faster runs without LLM search actions.
• **Parameterize query**: Accept `SEARCH_QUERY` from CLI or env for different products without editing code.
• **Paginate**: Extend extraction to multiple pages or increase the number of products per run.

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev
📚 Python SDK: https://docs.stagehand.dev/v4/sdk/python
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
