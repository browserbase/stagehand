# Stagehand + Browserbase: Market Research Automation

## AT A GLANCE

- Goal: demonstrate how to automate market research on prediction markets using Stagehand.
- Semantic Navigation: uses `act()` to search for and open the requested live market.
- Data Extraction: extract structured market data with validated output using Zod schemas.
- Practical Example: research and extract current odds from Polymarket prediction markets.

## GLOSSARY

- extract: pull structured data from web pages into validated objects.
  Docs → https://docs.stagehand.dev/v4/basics/extract
- schema: a Zod definition that enforces data types, optional fields, and validation rules.
  Docs → https://zod.dev/
- market research automation: navigate to a specific prediction market and extract current odds.
- structured data extraction: convert unstructured web content into typed, validated objects.

## QUICKSTART

1.  cd polymarket-research
2.  npm install
3.  cp ../../.env.example .env (or create .env with BROWSERBASE_API_KEY)
4.  Add your Browserbase API key to .env
5.  npm start

## EXPECTED OUTPUT

- Navigates to Polymarket prediction market website
- Opens the configured market URL directly
- Extracts structured market data including odds, prices, and volume
- Returns typed object with market information

## COMMON PITFALLS

- "Cannot find module 'dotenv'": ensure npm install ran successfully
- Missing API key: verify .env is loaded and file is not committed
- Market not found: check whether the configured market URL still exists
- Schema validation errors: ensure extracted data matches Zod schema structure

## USE CASES

• Market tracking: automate monitoring of prediction market odds for specific events or topics.
• Research aggregation: collect current prices and volume data from multiple prediction markets.
• Trading automation: extract structured market data for integration with trading or analysis systems.
• Sentiment analysis: track how prediction markets assess the likelihood of future events.

## NEXT STEPS

• Parameterize market URLs: make the target market configurable via environment variables or CLI input.
• Multi-market extraction: extend the flow to search and extract data from multiple markets in parallel.
• Historical tracking: persist extracted data over time to track market movement and trends.
• Price alerts: add logic to monitor specific price thresholds and send notifications.

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
