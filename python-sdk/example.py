# example.py
import asyncio
from stagehand import Stagehand

async def main():
    # Creates instance and automatically manages NextJS server
    browser = Stagehand(
        env="BROWSERBASE",
        api_key="your-key",
        project_id="your-project"
    )
    
    # Use exactly like the TypeScript version
    result = await browser.act("Navigate to google.com")
    data = await browser.extract("Get the search results", {
        "results": [{"title": "string", "url": "string"}]
    })
    
    await browser.close()

asyncio.run(main())