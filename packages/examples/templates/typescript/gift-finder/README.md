# Stagehand + Browserbase: AI-Powered Gift Finder

## AT A GLANCE

- Goal: find personalized gift recommendations using AI-generated search queries and intelligent product scoring.
- AI Integration: OpenAI through Vercel AI Gateway generates and scores personalized search terms; Stagehand searches and extracts the live products. A direct OpenAI key remains a fallback.
- Concurrent Sessions: runs multiple browser sessions simultaneously to search different queries in parallel.

## GLOSSARY

- act: perform UI actions from a prompt (search, click, type)
  Docs → https://docs.stagehand.dev/v4/basics/act
- extract: pull structured data from pages using schemas
  Docs → https://docs.stagehand.dev/v4/basics/extract
- concurrent sessions: run multiple browser sessions simultaneously for faster searching
  Docs → https://docs.browserbase.com/guides/concurrency-rate-limits
- proxies: use geolocation-based routing for European website access (Firebox.eu)
  Docs → https://docs.browserbase.com/features/proxies

## QUICKSTART

1. cd gift-finder
2. npm install
3. cp .env.example .env
4. Add `BROWSERBASE_API_KEY` and `AI_GATEWAY_API_KEY` to .env
5. npm start

## EXPECTED OUTPUT

- Reads the recipient and description from `CONFIG` in `index.ts`
- Generates 3 search queries using OpenAI
- Runs concurrent browser sessions to search Firebox.eu
- Extracts product data using structured schemas
- AI-scores products based on recipient profile
- Displays top 3 personalized gift recommendations

## COMMON PITFALLS

- "Cannot find module": ensure all dependencies are installed
- Missing credentials: verify .env contains BROWSERBASE_API_KEY and AI_GATEWAY_API_KEY (or OPENAI_API_KEY for the direct fallback)
- Search failures: check internet connection and website accessibility

## USE CASES

• Multi-retailer product discovery: Generate smart queries, browse in parallel, and extract structured results across sites (with geo-specific proxies when needed).
• Personalized gifting/recommendations: Score items against a recipient profile for gift lists, concierge shopping, or corporate gifting portals.
• Assortment & market checks: Rapidly sample categories to compare price/availability/ratings across regions or competitors.

## NEXT STEPS

• Add site adapters: Plug in more retailers with per-site extract schemas, result normalization, and de-duplication (canonical URL matching).
• Upgrade ranking: Blend AI scores with signals (price, reviews, shipping, stock), and persist results to JSON/CSV/DB for re-scoring and audits.
• Scale & geo-test: Fan out more concurrent sessions and run a geo matrix via proxies (e.g., UK/EU/US) to compare localized inventory and pricing.

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
