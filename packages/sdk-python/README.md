<div id="toc" align="center" style="margin-bottom: 0;">
  <ul style="list-style: none; margin: 0; padding: 0;">
    <a href="https://stagehand.dev">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/browserbase/stagehand/main/media/dark_logo.png" />
        <img alt="Stagehand" src="https://raw.githubusercontent.com/browserbase/stagehand/main/media/light_logo.png" width="200" style="margin-right: 30px;" />
      </picture>
    </a>
  </ul>
</div>
<p align="center">
  <strong>Stagehand is the SDK for browser agents.</strong><br>
  <a href="https://docs.stagehand.dev">Read the Docs</a>
</p>

<p align="center">
  <a href="https://github.com/browserbase/stagehand/tree/main?tab=MIT-1-ov-file#MIT-1-ov-file">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/browserbase/stagehand/main/media/dark_license.svg" />
      <img alt="MIT License" src="https://raw.githubusercontent.com/browserbase/stagehand/main/media/light_license.svg" />
    </picture>
  </a>
  <a href="https://discord.gg/stagehand">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/browserbase/stagehand/main/media/dark_discord.svg" />
      <img alt="Discord Community" src="https://raw.githubusercontent.com/browserbase/stagehand/main/media/light_discord.svg" />
    </picture>
  </a>
</p>

<p align="center">
	<a href="https://trendshift.io/repositories/12122" target="_blank"><img src="https://trendshift.io/api/badge/repositories/12122" alt="browserbase%2Fstagehand | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="https://deepwiki.com/browserbase/stagehand">
    <img alt="Ask DeepWiki" src="https://deepwiki.com/badge.svg" />
  </a>
</p>

# Stagehand Python SDK

## What is Stagehand?

Stagehand is the SDK for browser agents. Playwright was built for testing, Stagehand is built for agents. Use familiar APIs, self-healing actions, and network-level security across TypeScript, Python, and Go.

## Why Stagehand?

Stagehand gives browser agents an interface built for how they actually work. It combines familiar Playwright-style APIs with self-healing actions, agent-optimized page context, and native support for complex DOM structures like out-of-process iframes and closed Shadow DOMs.

Agents use fewer tokens, recover when websites change, and complete tasks more reliably. With a complete browser driver across TypeScript, Python, and Go, Stagehand delivers the flexibility of AI without sacrificing the speed, control, determinism, reliability, and observability required in production.

For the full overview, examples, and contributing guide, see the [main README](https://github.com/browserbase/stagehand/blob/main/README.md).

## Example

The async Python SDK for Stagehand browser automation:

```python
import asyncio
import os

from pydantic import BaseModel

from stagehand import Stagehand, browserbase, local_browser


class PullRequest(BaseModel):
    author: str
    title: str


async def main() -> None:
    browser = await local_browser.launch(headless=True)
    try:
        stagehand = await Stagehand.create(
            browser=browser,
            model="openai/gpt-5.4-mini",
            model_api_key=os.environ["OPENAI_API_KEY"],
        )
        try:
            page = (await browser.context.pages())[0]
            await page.goto("https://github.com/browserbase")

            # act() executes individual actions
            await stagehand.act("click on the stagehand repo")

            # observe() reports what is actionable on the page
            observed = await stagehand.observe("find the latest PR")

            # Locators give deterministic, Playwright-style actions
            await page.locator(observed.data[0].selector).click()

            # extract() returns structured data validated by a pydantic model
            result = await stagehand.extract(
                "extract the author and title of the PR",
                PullRequest,
            )
            print(result.data.author, result.data.title)
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

The same `browserbase` facade exposes Browserbase Search and Fetch without launching a browser:

```python
import asyncio
import os

from stagehand import browserbase


async def search_and_fetch() -> None:
    results = await browserbase.search(
        api_key=os.environ["BROWSERBASE_API_KEY"],
        query="browser agent frameworks",
        num_results=5,
    )
    fetched = await browserbase.fetch(
        api_key=os.environ["BROWSERBASE_API_KEY"],
        url=results.results[0].url,
        format="markdown",
    )
    print(fetched.content)


asyncio.run(search_and_fetch())
```

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
