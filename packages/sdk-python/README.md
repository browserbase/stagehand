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
            page = (await browser.context.pages())[0]
            if page is None:
                raise RuntimeError("Stagehand initialized without an active page")
            response = await page.goto("https://example.com")
            if response is not None:
                print(response.status, await response.text())
            await stagehand.observe("Find the more information link")
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
`local_browser`. A launched session is released when you `close()` the browser handle, except with
`keep_alive=True`: that handle's `close()` only disconnects, and the session keeps running until it
is released out of band (Browserbase dashboard or API) or reaches its configured timeout. The
Stagehand extension that `launch()` uploaded for that session is retained on the account for the
same reason, so a `keep_alive=True` workflow that launches repeatedly accumulates extensions until
they are deleted out of band. Sessions reached through `browserbase.connect()` are never released by
`close()` — whoever created the session owns it.

`Stagehand.act()`, `Stagehand.observe()`, and `Stagehand.extract()` use the active page by
default. Pass `page=page` to target a specific SDK `Page`.

`Page.goto()`, `reload()`, `go_back()`, and `go_forward()` return the main-document `Response`,
or `None` when navigation does not produce one. Response bodies and complete headers are retrieved
lazily while the Stagehand session remains open.

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
