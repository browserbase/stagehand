# Browserbase Proxy Testing Script

## AT A GLANCE

- Goal: demonstrate different proxy configurations with Browserbase sessions.

## GLOSSARY

- Proxies: Browserbase's default proxy rotation for enhanced privacy
  Docs → https://docs.browserbase.com/features/proxies

## QUICKSTART

1. cd proxies
2. Install the template dependencies
3. cp .env.example .env
4. Add your Browserbase API key to .env
5. Run the template entrypoint

## EXPECTED OUTPUT

- Tests built-in proxy rotation
- Tests geolocation-specific proxies (New York)
- Displays IP information and geolocation data for each test
- Verifies that the New York session reports the expected region/country/timezone and a different IP

## COMMON PITFALLS

- Browserbase Developer plan or higher is required to use proxies
- "Cannot find module": ensure all dependencies are installed
- Missing credentials: verify .env contains BROWSERBASE_API_KEY

## USE CASES

• Geo-testing: Verify location-specific content, pricing, or compliance banners.
• Scraping at scale: Rotate IPs to reduce blocks and increase CAPTCHA success rates.
• Custom routing: Add external proxies or domain-based rules for compliance.

## NEXT STEPS

• Add routing rules: Configure domainPattern to direct specific sites through targeted proxies.
• Test multiple geos: Compare responses from different cities/countries and log differences.
• Improve reliability: Add retries and fallbacks to handle proxy errors like ERR_TUNNEL_CONNECTION_FAILED.

## HELPFUL RESOURCES

📚 Stagehand Docs: https://docs.stagehand.dev/v4/first-steps/introduction
🎮 Browserbase: https://www.browserbase.com
💡 Try it out: https://www.browserbase.com/playground
🔧 Templates: https://www.browserbase.com/templates
📧 Need help? support@browserbase.com
💬 Discord: http://stagehand.dev/discord
