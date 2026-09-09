# Stagehand + Browserbase: Philadelphia Council Events Scraper

Stagehand is the SDK for browser agents.

## AT A GLANCE

- Goal: automate extraction of Philadelphia Council events for 2025 from the official calendar.
- Flow: navigate to phila.legistar.com → click calendar → select 2025 → extract event data (name, date, time).
- Benefits: quickly gather upcoming council events without manual browsing, structured data ready for analysis or notifications.
  Docs → https://docs.stagehand.dev/v4/first-steps/introduction

## GLOSSARY

- act: perform UI actions from a prompt (click, select, navigate).
  Docs → https://docs.stagehand.dev/v4/basics/act
- extract: pull structured data from a page using AI and Pydantic schemas.
  Docs → https://docs.stagehand.dev/v4/basics/extract
- Pydantic schema: type-safe data models that validate extracted content.

## QUICKSTART

1.  cd council-events
2.  uv venv && source .venv/bin/activate # On Windows: .venv\Scripts\activate
3.  pip install stagehand python-dotenv pydantic
4.  cp .env.example .env # Add your Browserbase API key to .env
5.  python main.py

## EXPECTED OUTPUT

- Initializes Stagehand session with Browserbase
- Navigates to Philadelphia Council calendar
- Selects 2025 events from dropdown
- Extracts event names, dates, and times
- Displays structured JSON output with all events
- Provides live session URL for monitoring
- Closes session cleanly

## COMMON PITFALLS

- "ModuleNotFoundError": ensure all dependencies are installed via pip
- Missing credentials: verify .env contains BROWSERBASE_API_KEY
- No events found: check if the website structure has changed or if 2025 calendar is available
- Network issues: ensure internet access and phila.legistar.com is accessible
- Import errors: activate your virtual environment if you created one

## USE CASES

• Civic monitoring: Track upcoming council meetings, hearings, and votes for advocacy or journalism.
• Event aggregation: Pull council calendars into dashboards, newsletters, or community notification systems.
• Research & analysis: Collect historical event data to analyze meeting frequency, topics, or scheduling patterns.

## NEXT STEPS

• Multi-year extraction: Loop through multiple years to build historical event database.
• Event details: Click into individual events to extract agendas, attendees, and documents.
• Notifications: Set up scheduled runs to detect new events and send alerts via email/Slack.

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
