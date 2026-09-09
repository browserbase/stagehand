# Stagehand + Browserbase: Polymarket Prediction Market Research

Stagehand is the SDK for browser agents.

## AT A GLANCE

- Goal: automate research of prediction markets on Polymarket to extract current odds, pricing, and volume data.
- Flow: navigate to polymarket.com → search for market → select result → extract market data (odds, prices, volume, changes).
- Benefits: quickly gather market intelligence on prediction markets without manual browsing, structured data ready for analysis or trading decisions.
  Docs → https://docs.stagehand.dev/v4/first-steps/introduction

## GLOSSARY

- act: perform UI actions from a prompt (click, type, search).
  Docs → https://docs.stagehand.dev/v4/basics/act
- extract: pull structured data from a page using AI and Pydantic schemas.
  Docs → https://docs.stagehand.dev/v4/basics/extract
- prediction market: a market where participants trade contracts based on the outcome of future events.

## QUICKSTART

1.  cd polymarket-research
2.  uv venv && source .venv/bin/activate # On Windows: .venv\Scripts\activate
3.  pip install stagehand python-dotenv pydantic
4.  cp .env.example .env # Add your Browserbase API key to .env
5.  python main.py

## EXPECTED OUTPUT

- Initializes Stagehand session with Browserbase
- Navigates to Polymarket website
- Searches for "Elon Musk unfollow Trump" prediction market
- Selects first market result from search dropdown
- Extracts market data: title, odds, yes/no prices, volume, price changes
- Displays structured JSON output with market information
- Provides live session URL for monitoring
- Closes session cleanly

## COMMON PITFALLS

- "ModuleNotFoundError": ensure all dependencies are installed via pip
- Missing credentials: verify .env contains BROWSERBASE_API_KEY
- No search results: check if the search query returns valid markets or try different search terms
- Network issues: ensure internet access and polymarket.com is accessible
- Import errors: activate your virtual environment if you created one

## USE CASES

• Market research: Track odds and sentiment on political events, sports outcomes, or business predictions.
• Trading analysis: Monitor price movements, volume trends, and market efficiency for investment decisions.
• News aggregation: Collect prediction market data to supplement traditional news sources with crowd-sourced forecasts.

## NEXT STEPS

• Multi-market tracking: Loop through multiple markets to build comprehensive prediction database.
• Historical analysis: Track price changes over time to identify trends and patterns.
• Automated alerts: Set up scheduled runs to detect significant market movements and send notifications.

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
