# Stagehand + Browserbase: Google Trends Keywords Extractor

Stagehand is the SDK for browser agents.

## AT A GLANCE

- Goal: Extract trending search keywords from Google Trends for any country with structured JSON output.
- Configurable by country code (US, GB, IN, DE, etc.) and language preference.
- Uses JSON schema validation for consistent, typed data extraction.
- Docs → https://docs.stagehand.dev/v4/basics/extract

## GLOSSARY

- extract: extract structured data from web pages using natural language instructions and JSON schemas
  Docs → https://docs.stagehand.dev/v4/basics/extract
- act: perform UI actions from a prompt (click, type, dismiss dialogs)
  Docs → https://docs.stagehand.dev/v4/basics/act

## QUICKSTART

1. uv sync
2. cp .env.example .env # Add your Browserbase API key to .env
3. uv run python main.py

## EXPECTED OUTPUT

- Initializes Stagehand session with Browserbase
- Displays live session link for monitoring
- Navigates to Google Trends trending page with configured country/language
- Dismisses any consent dialogs if present
- Extracts trending keywords with rank positions
- Outputs structured JSON with country code, language, timestamp, and keyword list
- Closes session cleanly

## COMMON PITFALLS

- "ModuleNotFoundError": ensure all dependencies are installed via `uv sync`
- Missing credentials: verify .env contains BROWSERBASE_API_KEY
- Invalid country code: ensure country code is a valid 2-letter ISO code (US, GB, IN, DE, FR, BR, etc.)
- Empty results: Google Trends may not have trending data for all country/language combinations
- Find more information on your Browserbase dashboard -> https://www.browserbase.com/sign-in

## USE CASES

• Market research: Track trending topics across different regions to identify emerging interests and market opportunities.
• Content strategy: Discover popular search terms to inform blog posts, social media content, or SEO keyword targeting.
• Competitive intelligence: Monitor trending keywords in your industry to stay ahead of market shifts and consumer interests.

## NEXT STEPS

• Parameterize inputs: Accept country code and limit as command-line arguments or environment variables for flexible deployment.
• Historical tracking: Store extracted keywords with timestamps to build a trends database and analyze keyword momentum over time.
• Multi-region comparison: Extend to fetch trends from multiple countries in parallel and compare regional differences.

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
