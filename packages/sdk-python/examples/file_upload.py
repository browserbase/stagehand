import asyncio
import tempfile
from pathlib import Path

from stagehand import Stagehand, local_browser


async def main() -> None:
    with tempfile.TemporaryDirectory(prefix="stagehand-upload-") as directory:
        file_path = Path(directory, "hello.txt")
        file_path.write_text("hello from Python")

        browser = await local_browser.launch(headless=True)
        try:
            stagehand = await Stagehand.create(browser=browser)
            try:
                page = await stagehand.context.active_page()
                if page is None:
                    raise RuntimeError("Stagehand initialized without an active page")

                await page.goto('data:text/html,<input id="upload" type="file">')
                await page.locator("#upload").set_input_files(file_path)

                uploaded = await page.evaluate("""(async () => {
                    const file = document.querySelector('#upload').files[0];
                    return file ? { name: file.name, text: await file.text() } : null;
                })()""")
                expected = {"name": "hello.txt", "text": "hello from Python"}
                if uploaded != expected:
                    raise RuntimeError(f"Unexpected uploaded file: {uploaded!r}")
                print(uploaded)
            finally:
                await stagehand.close()
        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
