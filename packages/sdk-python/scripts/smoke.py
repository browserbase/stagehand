from __future__ import annotations

import asyncio
import os
from pathlib import Path
from urllib.parse import quote
from zipfile import ZipFile

import stagehand
from stagehand import Stagehand


async def main() -> None:
    package_root = Path(stagehand.__file__).parent
    if not (package_root / "_extension" / "manifest.json").is_file():
        raise RuntimeError("Installed Stagehand distribution is missing its browser extension")
    extension_archive = package_root / "_extension" / "stagehand-extension.zip"
    if not extension_archive.is_file():
        raise RuntimeError(
            "Installed Stagehand distribution is missing its Browserbase extension archive"
        )
    with ZipFile(extension_archive) as archive:
        if "manifest.json" not in archive.namelist():
            raise RuntimeError("Installed Stagehand Browserbase extension archive is invalid")

    async with Stagehand(
        browser="local",
        headless=True,
        executable_path=os.environ.get("CHROME_PATH"),
    ) as client:
        page = await client.context.new_page()
        await page.goto(f"data:text/html,{quote('<title>Stagehand package smoke</title>')}")
        if await page.title() != "Stagehand package smoke":
            raise RuntimeError("Installed Stagehand distribution could not navigate with Chrome")


if __name__ == "__main__":
    asyncio.run(main())
