# Stagehand Python SDK

The async Python SDK for Stagehand browser automation.

```python
import asyncio

from stagehand import Stagehand


async def main() -> None:
    stagehand = Stagehand(browser="local", headless=True)
    try:
        await stagehand.init()
        page = await stagehand.context.active_page()
        if page is None:
            raise RuntimeError("Stagehand initialized without an active page")
        await page.goto("https://example.com")
        await stagehand.observe(instruction="Find the more information link")
        print(await page.title())
    finally:
        await stagehand.close()


asyncio.run(main())
```

See [`examples`](examples) for action, extraction, observation, and custom LLM usage.

`Stagehand.act()`, `Stagehand.observe()`, and `Stagehand.extract()` use the active page by
default. Pass `page=page` to target a specific SDK `Page`.

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
