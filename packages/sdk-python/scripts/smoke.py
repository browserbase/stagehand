from __future__ import annotations

import asyncio
import os
from pathlib import Path
from urllib.parse import quote

import stagehand as stagehand_package
from stagehand import Stagehand, local_browser


async def main() -> None:
    package_root = Path(stagehand_package.__file__).parent
    if not (package_root / "_extension" / "manifest.json").is_file():
        raise RuntimeError("Installed Stagehand distribution is missing its browser extension")

    browser = await local_browser.launch(
        headless=True,
        executable_path=os.environ.get("CHROME_PATH"),
    )
    try:
        stagehand = await Stagehand.create(browser=browser)
        try:
            page = await stagehand.context.new_page()
            await page.goto(f"data:text/html,{quote('<title>Stagehand package smoke</title>')}")
            if await page.title() != "Stagehand package smoke":
                raise RuntimeError(
                    "Installed Stagehand distribution could not navigate with Chrome"
                )
        finally:
            await stagehand.close()
    finally:
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
