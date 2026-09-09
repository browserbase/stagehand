# Stagehand + Browserbase: Amazon Product Scraping

## AT A GLANCE

- Goal: scrape the first 3 Amazon search results for a given query and return structured product data.
- Semantic Search: uses `act()` to find and operate Amazon's current search UI.
- Structured Results: uses `extract()` with Zod to return and validate product name, price, rating, review count, and URL.
- Model: uses `google/gemini-2.5-flash` for fast, cost-effective automation.
  Docs → https://docs.stagehand.dev

## GLOSSARY

- act / extract: use natural-language interaction and schema-validated semantic extraction
  Docs → https://docs.stagehand.dev/v4/basics/act

## QUICKSTART

1. cd typescript/amazon-product-scraping
2. npm install
3. cp .env.example .env (or create .env with required keys)
4. Add BROWSERBASE_API_KEY to .env
5. Optionally edit SEARCH_QUERY in index.ts
6. npm start

## EXPECTED OUTPUT

- Initializes Stagehand session with Browserbase
- Uses `act()` to run the configured search through Amazon's live UI
- Returns structured product-detail records with Zod
- Extracts the first 3 products with name, price, rating, reviews count, and product URL
- Outputs JSON to console
- Closes session cleanly

## COMMON PITFALLS

- "Cannot find module": ensure npm install completed
- Missing credentials: verify .env contains BROWSERBASE_API_KEY
- Amazon access challenges: retry if Amazon presents a CAPTCHA or consent interstitial
- Find more information on your Browserbase dashboard → https://www.browserbase.com/sign-in

## USE CASES

• Price monitoring: Scrape top results for a product query to track prices and availability over time.
• Competitor research: Extract product titles, ratings, and review counts for comparison.
• Catalog building: Pull structured product data for feeds, dashboards, or internal tools.

## NEXT STEPS

• Parameterize storefront: Accept an Amazon domain or country from CLI/env.
• Parameterize query: Accept SEARCH_QUERY from CLI or env for different products without editing code.
• Paginate: Extend extraction to multiple pages or increase the number of products per run.

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
