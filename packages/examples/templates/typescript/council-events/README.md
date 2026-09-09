# Stagehand + Browserbase: Council Events Automation

## AT A GLANCE

- Goal: demonstrate how to automate event information extraction from Philadelphia Council.
- Navigation & Search: automate website navigation, calendar selection, and year filtering.
- Data Extraction: extract structured event data with validated output using Zod schemas.
- Practical Example: extract council events with name, date, and time information.

## GLOSSARY

- act: perform UI actions from a natural language prompt (type, click, navigate).
  Docs → https://docs.stagehand.dev/v4/basics/act
- extract: pull structured data from web pages into validated objects.
  Docs → https://docs.stagehand.dev/v4/basics/extract
- schema: a Zod definition that enforces data types, optional fields, and validation rules.
  Docs → https://zod.dev/
- council events automation: navigate to council website, select calendar, and extract event information.
- structured data extraction: convert unstructured web content into typed, validated objects.

## QUICKSTART

1.  cd councilEvents
2.  npm install
3.  cp .env.example .env (or create .env with BROWSERBASE_API_KEY)
4.  Add your Browserbase API key to .env
5.  npm start

## EXPECTED OUTPUT

- Navigates to Philadelphia Council website
- Clicks calendar from the navigation menu
- Selects 2025 from the year dropdown
- Extracts structured event data including name, date, and time
- Returns typed object with event information

## COMMON PITFALLS

- "Cannot find module 'dotenv'": ensure npm install ran successfully
- Missing API key: verify .env is loaded and file is not committed
- Events not found: check if the website structure has changed or if no events exist for the selected period
- Schema validation errors: ensure extracted data matches Zod schema structure

## USE CASES

• Event tracking: automate monitoring of council meetings and public events.
• Calendar aggregation: collect event information for integration with calendar systems.
• Public information access: extract structured event data for citizens and researchers.
• Meeting scheduling: track upcoming council meetings for attendance planning.

## NEXT STEPS

• Date filtering: make the year or date selection configurable via environment variables or prompts.
• Multi-year extraction: extend the flow to extract events from multiple years in parallel.
• Calendar integration: add logic to export extracted events to calendar formats (iCal, Google Calendar).
• Event notifications: add logic to send alerts for upcoming meetings or important events.

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
