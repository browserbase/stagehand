# Stagehand Python SDK

The async Python SDK for Stagehand browser automation.

```python
import asyncio

from stagehand import Stagehand, local_browser


async def main() -> None:
    browser = await local_browser.launch(headless=True)
    try:
        stagehand = await Stagehand.create(browser=browser)
        try:
            page = await stagehand.context.active_page()
            if page is None:
                raise RuntimeError("Stagehand initialized without an active page")
            await page.goto("https://example.com")
            await stagehand.observe(instruction="Find the more information link")
            print(await page.title())
        finally:
            await stagehand.close()
    finally:
        await browser.close()


asyncio.run(main())
```

See [`examples`](examples) for action, extraction, observation, and custom LLM usage.

For hosted browsers, import `browserbase` from `stagehand` and use
`browserbase.launch(api_key=...)` or `browserbase.connect(api_key=..., session_id=...)` instead of
`local_browser`. With `keep_alive=True`, the caller is responsible for releasing the Browserbase
session.

`Stagehand.act()`, `Stagehand.observe()`, and `Stagehand.extract()` use the active page by
default. Pass `page=page` to target a specific SDK `Page`.

When contributing examples or tests, keep browser ownership explicit: launch or connect a
browser handle, pass it to `Stagehand.create()`, close Stagehand first, and close the browser in
the outermost `finally` block.

## Contributing

```bash
# Install uv
curl -LsSf https://astral.sh/uv/install.sh | sh

# Install just
brew install just

just install
just generate
just check
just test
just build
```
