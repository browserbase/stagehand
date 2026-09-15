import asyncio
import os
from stagehand import Stagehand, StagehandConfig
from dotenv import load_dotenv

load_dotenv()

async def main():
    config = StagehandConfig(
        env="BROWSERBASE",
        api_key=os.getenv("BROWSERBASE_API_KEY"),
        project_id=os.getenv("BROWSERBASE_PROJECT_ID"),
        model_name="gpt-4o",
        model_api_key=os.getenv("MODEL_API_KEY"),
        browserbase_session_create_params={
            "project_id": os.getenv("BROWSERBASE_PROJECT_ID"),
            "browser_settings": {
                "extension_id": os.getenv("EXTENSION_ID")
            }
        }
    )
    stagehand = Stagehand(config)
    try:
        await stagehand.init()
        page = stagehand.page

        await page.goto("chrome-extension://aeblfdkhhhdcdjpifhhbdiojplfjncoa/app/app.html#/page/welcome")
        await page.act("click the Continue button")
        await page.act("click the Sign in button")

        # wait 60 seconds
        await asyncio.sleep(60)

        await page.goto("https://browserbase.com/sign-in")
        await asyncio.sleep(10)

    finally:
        await stagehand.close()

if __name__ == "__main__":
    asyncio.run(main())