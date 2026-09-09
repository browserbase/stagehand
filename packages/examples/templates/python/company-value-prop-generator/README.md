# Stagehand + Browserbase: Value Prop One-Liner Generator

Stagehand is the SDK for browser agents.

## AT A GLANCE

- Goal: Automatically extract and format website value propositions into concise one-liners for email personalization
- Demonstrates Stagehand's `extract` method with Pydantic schemas to pull structured data from landing pages
- Shows how to chain Stagehand V4 extractions to transform grounded page content with custom prompts
- Docs → https://docs.stagehand.dev/v4/basics/extract

## GLOSSARY

- Extract: Stagehand method that uses AI to pull structured data from pages using natural language instructions
  Docs → https://docs.stagehand.dev/v4/basics/extract
- Value Proposition: The core benefit or unique selling point a company communicates to customers

## QUICKSTART

1. cd python/company-value-prop-generator
2. pip install python-dotenv stagehand openai pydantic
3. cp .env.example .env # Add your Browserbase API key to .env
4. python main.py

## EXPECTED OUTPUT

- Stagehand initializes and creates a Browserbase session
- Navigates to target domain and waits for page load
- Extracts value proposition from landing page using AI
- Generates formatted one-liner via LLM (constraints: 9 words max, starts with "your")
- Prints generated one-liner to console
- Closes browser session

## COMMON PITFALLS

- Dependency install errors: ensure pip install completed
- Missing credentials:
  - BROWSERBASE_API_KEY (required for browser automation)
- Placeholder pages: extraction quality depends on the content available on the target page
- Slow-loading sites: 5-minute timeout configured, but extremely slow sites may still timeout

## USE CASES

• Generate personalized email openers by extracting value props from prospect domains
• Build prospecting tools that automatically understand what companies do from their websites
• Create dynamic messaging systems that adapt content based on extracted company information

## NEXT STEPS

• Batch process multiple domains by iterating over a list and aggregating results
• Extract additional metadata like company description, industry tags, or key features alongside value prop
• Add caching layer to avoid re-extracting value props for previously analyzed domains

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
💡 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
