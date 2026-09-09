# Stagehand + Browserbase: Weather Proxy Demo

## AT A GLANCE

- Goal: demonstrate geolocation proxies by fetching location-specific weather data from multiple cities using Browserbase's proxy infrastructure.
- Uses geolocation proxies to route traffic through specific geographic locations (New York, London, Tokyo, São Paulo).
- Uses `extract()` to read current `wttr.in` JSON through each proxied browser and verifies that the service reports the expected country.
- Sequential processing shows how different proxy locations return different weather data from the same website.
- Docs → https://docs.browserbase.com/features/proxies

## GLOSSARY

- geolocation proxies: route traffic through specific geographic locations (city, country, state) to access location-specific content
  Docs → https://docs.browserbase.com/features/proxies#set-proxy-geolocation
- extract: convert each weather response into schema-validated data
  Docs → https://docs.stagehand.dev/v4/basics/extract
- proxies: Browserbase's managed proxy infrastructure supporting 201+ countries for geolocation-based routing
  Docs → https://docs.browserbase.com/features/proxies

## QUICKSTART

1. cd proxies-weather
2. pnpm install
3. cp .env.example .env
4. Add your Browserbase API key to .env
5. pnpm start

## EXPECTED OUTPUT

- Creates Browserbase sessions with geolocation proxies for each location (New York, London, Tokyo, São Paulo)
- Closes each Stagehand instance and Browserbase browser handle after extraction
- Navigates to `wttr.in` through location-specific proxies
- Validates temperature, conditions, nearest reported location, and country for every proxy
- Displays formatted results showing different weather data based on proxy location
- Demonstrates how geolocation proxies enable location-specific content access

## COMMON PITFALLS

- Browserbase Developer plan or higher is required to use proxies
- "Cannot find module": install the template dependencies with `pnpm install`
- Missing credentials: verify .env contains BROWSERBASE_API_KEY
- Geolocation fields are case-insensitive (city, country, state can be any case)
- State is required for US locations to ensure accurate geolocation
- ERR_TUNNEL_CONNECTION_FAILED: indicates either a temporary proxy hiccup or a site unsupported by our built-in proxies

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
