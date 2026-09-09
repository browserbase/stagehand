# Stagehand + Browserbase: Weather Proxy Demo

Stagehand is the SDK for browser agents.

## AT A GLANCE

- Goal: demonstrate geolocation proxies by fetching location-specific weather data from multiple cities using Browserbase's proxy infrastructure.
- Uses geolocation proxies to route traffic through specific geographic locations (New York, London, Tokyo, São Paulo).
- Extracts structured weather data using Stagehand's extraction capabilities with Pydantic schema validation.
- Sequential processing shows how different proxy locations return different weather data from the same website.
- Docs → https://docs.browserbase.com/features/proxies

## GLOSSARY

- geolocation proxies: route traffic through specific geographic locations (city, country, state) to access location-specific content
  Docs → https://docs.browserbase.com/features/proxies#set-proxy-geolocation
- extract: extract structured data from web pages using natural language instructions and Pydantic schemas
  Docs → https://docs.stagehand.dev/v4/basics/extract
- proxies: Browserbase's managed proxy infrastructure supporting 201+ countries for geolocation-based routing
  Docs → https://docs.browserbase.com/features/proxies

## QUICKSTART

1. cd proxies-weather-template
2. uv venv venv
3. source venv/bin/activate # On Windows: venv\Scripts\activate
4. uvx install stagehand browserbase python-dotenv pydantic
5. cp .env.example .env
6. Add your Browserbase API key to .env
7. python main.py

## EXPECTED OUTPUT

- Creates Browserbase sessions with geolocation proxies for each location (New York, London, Tokyo, São Paulo)
- Displays session URLs for each location for monitoring
- Navigates to weather service (windy.com) through location-specific proxies
- Extracts temperature and unit for each location
- Displays formatted results showing different weather data based on proxy location
- Demonstrates how geolocation proxies enable location-specific content access

## COMMON PITFALLS

- Browserbase Developer plan or higher is required to use proxies
- "ModuleNotFoundError": ensure all dependencies are installed via uvx install
- Missing credentials: verify .env contains BROWSERBASE_API_KEY
- Geolocation fields are case-insensitive (city, country, state can be any case)
- State is required for US locations to ensure accurate geolocation
- ERR_TUNNEL_CONNECTION_FAILED: indicates either a temporary proxy hiccup or a site unsupported by our built-in proxies
- Import errors: activate your virtual environment if you created one

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
