# Amazon Global Price Comparison

Stagehand is the SDK for browser agents.

## AT A GLANCE

- **Goal**: Compare Amazon product prices across multiple countries using geolocation proxies.
- **Pattern Template**: Demonstrates the integration of Browserbase geolocation proxies with Stagehand AI extraction for price comparison workflows.
- **Workflow**: Creates Browserbase sessions with geolocation proxies for each country, navigates to Amazon, searches for products, and extracts structured pricing data using Stagehand's AI-powered extraction.
- **Concurrent Processing**: Runs all country searches in parallel using `asyncio.gather()` for faster execution.
- **Structured Extraction**: Uses Pydantic schemas to extract consistent product data (name, price, rating, reviews) across different Amazon regions.
- Docs → [Browserbase Proxies](https://docs.browserbase.com/features/proxies) | [Stagehand Extract](https://docs.stagehand.dev/v4/basics/extract)

## GLOSSARY

- **geolocation proxies**: Route traffic through specific geographic locations (city, country) to access location-specific content and pricing.
  Docs → https://docs.browserbase.com/features/proxies#set-proxy-geolocation
- **extract**: Extract structured data from web pages using natural language instructions and JSON schemas.
  Docs → https://docs.stagehand.dev/v4/basics/extract
- **act**: Perform UI actions from natural language prompts (click, scroll, type, navigate).
  Docs → https://docs.stagehand.dev/v4/basics/act
- **proxies**: Browserbase's managed proxy infrastructure supporting 201+ countries for geolocation-based routing.
  Docs → https://docs.browserbase.com/features/proxies

## QUICKSTART

1. cd python/amazon-global-price-comparison
2. cp .env.example .env
3. Add required API keys to .env:
   - `BROWSERBASE_API_KEY`
4. Run the script:
   ```bash
   uv run python main.py
   ```

## EXPECTED OUTPUT

- Creates Browserbase sessions with geolocation proxies for each country (US, UK, DE, FR, IT, ES)
- Navigates to Amazon search results through location-specific proxies
- Extracts product name, price, rating, and review count for each location
- Displays formatted comparison table showing price differences across countries
- Outputs JSON results for programmatic use

## COMMON PITFALLS

- **Browserbase Developer plan or higher is required to use proxies**
- "ModuleNotFoundError": ensure you're running with `uv run python main.py` (uv automatically installs dependencies from pyproject.toml)
- Missing credentials: verify .env contains `BROWSERBASE_API_KEY`
- Geolocation fields are case-insensitive (city, country can be any case)
- Amazon may show different products in different regions - comparison works best for globally available products
- ERR_TUNNEL_CONNECTION_FAILED: indicates either a temporary proxy hiccup or a site unsupported by built-in proxies

## USE CASES

• **Price arbitrage**: Find the best country to purchase products from for international shipping
• **Market research**: Compare pricing strategies across different Amazon regions
• **Competitive analysis**: Monitor how competitors price products globally
• **Travel shopping**: Check prices before international trips to plan purchases

## NEXT STEPS

• **Add more countries**: Extend the `COUNTRIES` list with additional regions (Japan, Australia, Canada, etc.)
• **Currency conversion**: Add real-time currency conversion to normalize prices for comparison
• **Price tracking**: Store results over time to track price changes across regions
• **Email alerts**: Send notifications when price drops below a threshold in any country
• **Product matching**: Use fuzzy matching to ensure you're comparing the same product across regions

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
📚 Python SDK: https://docs.stagehand.dev/v4/sdk/python
📚 Browserbase Proxies: https://docs.browserbase.com/features/proxies
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
