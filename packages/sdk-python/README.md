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
        print(await page.title())
    finally:
        await stagehand.close()


asyncio.run(main())
```

See [`examples`](examples) for action, extraction, observation, and custom LLM usage.

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
