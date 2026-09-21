<div id="toc" align="center" style="margin-bottom: 0;">
  <ul style="list-style: none; margin: 0; padding: 0;">
    <a href="https://stagehand.dev">
      <picture>
        <source media="(prefers-color-scheme: dark)" srcset="media/dark_logo.png" />
        <img alt="Stagehand" src="media/light_logo.png" width="200" style="margin-right: 30px;" />
      </picture>
    </a>
  </ul>
</div>
<p align="center">
  <strong>Stagehand is the SDK for browser agents</strong><br>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/12122" target="_blank"><img src="https://trendshift.io/api/badge/repositories/12122" alt="browserbase%2Fstagehand | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="https://docs.stagehand.dev"><strong>Docs</strong></a> ·
  <a href="https://docs.stagehand.dev/v4/first-steps/quickstart"><strong>Quickstart</strong></a> ·
  <a href="https://github.com/browserbase/stagehand/stargazers"><strong>⭐ Star this repo</strong></a>
</p>

<p align="center">
  <a href="https://github.com/browserbase/stagehand/tree/main?tab=MIT-1-ov-file#MIT-1-ov-file">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="media/dark_license.svg" />
      <img alt="MIT License" src="media/light_license.svg" />
    </picture>
  </a>
  <a href="https://discord.gg/stagehand">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="media/dark_discord.svg" />
      <img alt="Discord Community" src="media/light_discord.svg" />
    </picture>
  </a>
  <a href="https://deepwiki.com/browserbase/stagehand">
    <img alt="Ask DeepWiki" src="https://deepwiki.com/badge.svg" />
  </a>
</p>

<p align="center">
  <a href="https://stagehand.dev">
    <img src="media/stagehand-website-banner.png" alt="Stagehand homepage showing browser automation in TypeScript, Python, and Go and a speed comparison with Playwright" width="100%" />
  </a>
</p>

## AI that uses the browser like humans.

Sign in once, keep the session, and pull structured data out the other side.

```typescript
import { localBrowser, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

// Cookies persist in ./browser-data, so the next run starts already signed in
const browser = await localBrowser.launch({ userDataDir: "./browser-data" });
const stagehand = await Stagehand.create({
  browser,
  model: { modelName: "openai/gpt-5.4-mini", apiKey: process.env.OPENAI_API_KEY },
});

const [page] = await browser.context.pages();
await page.goto("https://app.example.com/login");

// observe() returns real selectors, so credentials never reach the model
const { data: email } = await stagehand.observe("find the email input");
const { data: password } = await stagehand.observe("find the password input");
await page.locator(email[0].selector).fill(process.env.APP_EMAIL!);
await page.locator(password[0].selector).fill(process.env.APP_PASSWORD!);

// act() self-heals when the site redesigns its form
await stagehand.act("click the sign in button");
await stagehand.act("open the billing page");

// extract() returns schema-validated data
const { data } = await stagehand.extract(
  "extract every invoice in the table",
  z.object({
    invoices: z.array(z.object({ number: z.string(), amount: z.number(), paid: z.boolean() })),
  }),
);

console.log(data.invoices);

await stagehand.close();
await browser.close();
```

<details>
<summary><b>Python</b></summary>

```python
import asyncio
import os

from pydantic import BaseModel
from stagehand import Stagehand, local_browser


class Invoice(BaseModel):
    number: str
    amount: float
    paid: bool


class Invoices(BaseModel):
    invoices: list[Invoice]


async def main() -> None:
    # Cookies persist in ./browser-data, so the next run starts already signed in
    browser = await local_browser.launch(user_data_dir="./browser-data")
    try:
        stagehand = await Stagehand.create(
            browser=browser,
            model="openai/gpt-5.4-mini",
            model_api_key=os.environ["OPENAI_API_KEY"],
        )
        try:
            page = (await browser.context.pages())[0]
            await page.goto("https://app.example.com/login")

            # observe() returns real selectors, so credentials never reach the model
            email = await stagehand.observe("find the email input")
            password = await stagehand.observe("find the password input")
            await page.locator(email.data[0].selector).fill(os.environ["APP_EMAIL"])
            await page.locator(password.data[0].selector).fill(os.environ["APP_PASSWORD"])

            # act() self-heals when the site redesigns its form
            await stagehand.act("click the sign in button")
            await stagehand.act("open the billing page")

            # extract() returns schema-validated data
            result = await stagehand.extract(
                "extract every invoice in the table",
                Invoices,
            )
            print(result.data.invoices)
        finally:
            await stagehand.close()
    finally:
        await browser.close()


asyncio.run(main())
```

</details>

<details>
<summary><b>Go</b></summary>

```go
package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"

	stagehand "github.com/browserbase/stagehand/packages/sdk-go/v4"
)

type invoice struct {
	Number string  `json:"number"`
	Amount float64 `json:"amount"`
	Paid   bool    `json:"paid"`
}

type invoices struct {
	Invoices []invoice `json:"invoices"`
}

func main() {
	if err := run(context.Background()); err != nil {
		log.Fatal(err)
	}
}

func run(ctx context.Context) (err error) {
	// Cookies persist in ./browser-data, so the next run starts already signed in
	browser, err := stagehand.LaunchLocalBrowser(ctx, &stagehand.LocalBrowserLaunchOptions{
		UserDataDir: "./browser-data",
	})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, browser.Close(ctx)) }()

	modelAPIKey := os.Getenv("OPENAI_API_KEY")
	client, err := stagehand.Create(ctx, stagehand.CreateOptions{
		Browser: browser,
		Model: &stagehand.ModelConfig{
			ModelName: "openai/gpt-5.4-mini",
			APIKey:    &modelAPIKey,
		},
	})
	if err != nil {
		return err
	}
	defer func() { err = errors.Join(err, client.Close(ctx)) }()

	browserContext, err := browser.Context()
	if err != nil {
		return err
	}
	pages, err := browserContext.Pages(ctx)
	if err != nil {
		return err
	}
	page := pages[0]
	if _, err := page.Goto(ctx, "https://app.example.com/login", nil); err != nil {
		return err
	}

	// Observe returns real selectors, so credentials never reach the model
	emailInstruction := "find the email input"
	email, err := client.Observe(ctx, &emailInstruction, nil)
	if err != nil {
		return err
	}
	if err := page.Locator(email.Data[0].Selector).Fill(ctx, os.Getenv("APP_EMAIL")); err != nil {
		return err
	}

	passwordInstruction := "find the password input"
	password, err := client.Observe(ctx, &passwordInstruction, nil)
	if err != nil {
		return err
	}
	if err := page.Locator(password.Data[0].Selector).Fill(ctx, os.Getenv("APP_PASSWORD")); err != nil {
		return err
	}

	// Act self-heals when the site redesigns its form
	if _, err := client.Act(ctx, stagehand.ActInstruction("click the sign in button"), nil); err != nil {
		return err
	}
	if _, err := client.Act(ctx, stagehand.ActInstruction("open the billing page"), nil); err != nil {
		return err
	}

	// Extract returns data decoded into a Go type
	extracted, err := stagehand.Extract[invoices](
		ctx,
		client,
		"extract every invoice in the table",
		nil,
	)
	if err != nil {
		return err
	}
	fmt.Println(extracted.Data.Invoices)

	return nil
}
```

</details>

## Install

```bash
pnpm add @browserbasehq/stagehand 'zod@~4.4.3'
```

<details>
<summary><b>Python</b></summary>

```bash
pip install stagehand
```

</details>

<details>
<summary><b>Go</b></summary>

```bash
go get github.com/browserbase/stagehand/packages/sdk-go/v4@v4.0.0
```

</details>

Local runs need [Chrome](https://www.google.com/chrome/) installed. Full setup: [Quickstart](https://docs.stagehand.dev/v4/first-steps/quickstart).

## Why Stagehand

<table>
  <tr>
    <td><strong>Familiar APIs</strong></td>
    <td>The Playwright-style methods you and your agents already know: <code>goto</code>, <code>click</code>, <code>locator</code>, <code>screenshot</code>.</td>
  </tr>
  <tr>
    <td><strong>Token efficiency</strong></td>
    <td>Hybrid accessibility-tree trimming gives agents exactly the page context they need and nothing more.</td>
  </tr>
  <tr>
    <td><strong>Faster in production</strong></td>
    <td>Stagehand runs as an extension next to the browser, cutting round-trip latency on every action.</td>
  </tr>
  <tr>
    <td><strong>Self-healing</strong></td>
    <td><code>act</code>, <code>observe</code>, and <code>extract</code> refresh how an action happens when the site changes underneath it.</td>
  </tr>
  <tr>
    <td><strong>Built for agents</strong></td>
    <td>WebMCP, clipboard support, batch commands, deep locators for nested iframes and closed Shadow DOMs, OTel traces.</td>
  </tr>
  <tr>
    <td><strong>Three languages</strong></td>
    <td>One complete browser driver across TypeScript, Python, and Go.</td>
  </tr>
</table>

## Run it on Browserbase

Point the same script at [Browserbase](https://www.browserbase.com) and get 2x faster execution than Playwright cloud equivalent browsers. Configure the [Model Gateway](https://docs.stagehand.dev/v4/configuration/models#model-gateway) so you never wire up a provider, and enable [server-side caching](https://docs.stagehand.dev/v4/best-practices/caching) to cache repeated actions.

```typescript
import { browserbase, Stagehand } from "@browserbasehq/stagehand";

const browser = await browserbase.launch({ apiKey: process.env.BROWSERBASE_API_KEY! });

// No model configuration: the Model Gateway picks the cheapest model for each action
// cache: true: identical calls come back from Browserbase, no tokens spent
const stagehand = await Stagehand.create({ browser, cache: true });
```

<details>
<summary><b>Python</b></summary>

```python
import os

from stagehand import Stagehand, browserbase

browser = await browserbase.launch(api_key=os.environ["BROWSERBASE_API_KEY"])

# No model configuration: the Model Gateway picks the cheapest model for each action
# cache=True: identical calls come back from Browserbase, no tokens spent
stagehand = await Stagehand.create(browser=browser, cache=True)
```

</details>

<details>
<summary><b>Go</b></summary>

```go
browser, err := stagehand.LaunchBrowserbase(ctx, stagehand.BrowserbaseLaunchOptions{
	APIKey: os.Getenv("BROWSERBASE_API_KEY"),
})
if err != nil {
	return err
}

// No model configuration: the Model Gateway picks the cheapest model for each action
// CacheEnabled(true): identical calls come back from Browserbase, no tokens spent
cache := stagehand.CacheEnabled(true)
client, err := stagehand.Create(ctx, stagehand.CreateOptions{
	Browser: browser,
	Cache:   &cache,
})
if err != nil {
	return err
}
```

</details>

[Verified mode](https://docs.browserbase.com/platform/identity/verified-customization), [residential proxies](https://docs.browserbase.com/platform/identity/proxies), [persistent contexts](https://docs.browserbase.com/platform/browser/core-features/contexts), and [session recordings](https://docs.browserbase.com/platform/browser/observability/session-replay) come with it. [Get an API key](https://www.browserbase.com/overview) and learn how to configure your browser [here](https://docs.stagehand.dev/v4/configuration/browser).

## Give your coding agent a browser

The hosted Browserbase [MCP server](https://docs.stagehand.dev/integrations/mcp/setup) puts `navigate`, `act`, `observe`, and `extract` in any MCP client — no install, no local browser.

```bash
claude mcp add --transport http browserbase https://mcp.browserbase.com/mcp \
  --header "Authorization: Bearer $BROWSERBASE_API_KEY"
```

<details>
<summary><b>Cursor, Codex, and other MCP clients</b></summary>

```json
{
  "mcpServers": {
    "browserbase": {
      "url": "https://mcp.browserbase.com/mcp",
      "headers": { "Authorization": "Bearer YOUR_BROWSERBASE_API_KEY" }
    }
  }
}
```

</details>

## Search and fetch without a browser

[Fetch](https://docs.stagehand.dev/v4/add-ons/fetch) lets you grab the content of any URL as markdown. [Search](https://docs.stagehand.dev/v4/add-ons/search) provides fast, token-efficient web search results.
Both as a lightweight complement to browser sessions.

```typescript
import { browserbase } from "@browserbasehq/stagehand";

const { results } = await browserbase.search({
  apiKey: process.env.BROWSERBASE_API_KEY!,
  query: "browser agent frameworks",
  numResults: 5,
});

const fetched = await browserbase.fetch({
  apiKey: process.env.BROWSERBASE_API_KEY!,
  url: results[0].url,
  format: "markdown",
});

console.log(fetched.content);
```

## Docs and resources

<table>
  <tr>
    <td><a href="https://docs.stagehand.dev/v4/first-steps/quickstart">Quickstart</a></td>
    <td>Empty directory to working automation in three steps</td>
  </tr>
  <tr>
    <td><a href="https://docs.stagehand.dev/v4/reference/page">page</a> · <a href="https://docs.stagehand.dev/v4/reference/locator">locator</a></td>
    <td>Playwright-style browser and element APIs</td>
  </tr>
  <tr>
    <td><a href="https://docs.stagehand.dev/v4/basics/webmcp">WebMCP</a></td>
    <td>Discover and invoke WebMCP tools exposed by web pages</td>
  </tr>
  <tr>
    <td><a href="https://docs.stagehand.dev/v4/basics/act">act</a> · <a href="https://docs.stagehand.dev/v4/basics/extract">extract</a> · <a href="https://docs.stagehand.dev/v4/basics/observe">observe</a></td>
    <td>Browser actions and data extraction with natural language</td>
  </tr>
  <tr>
    <td><a href="https://docs.stagehand.dev/v4/add-ons/search">Search</a> · <a href="https://docs.stagehand.dev/v4/add-ons/fetch">Fetch</a></td>
    <td>Web search and page content without a browser</td>
  </tr>
  <tr>
    <td><a href="https://docs.stagehand.dev/v4/migrations/playwright">Migrate from Playwright</a></td>
    <td>Port an existing suite</td>
  </tr>
  <tr>
    <td><a href="https://docs.stagehand.dev/v4/integrations/overview">Integrations</a></td>
    <td>CrewAI, Mastra, Deep Agents, Vercel AI SDK, Claude Code, Codex</td>
  </tr>
  <tr>
    <td><a href="./packages/sdk-python/README.md">Python SDK</a> · <a href="./packages/sdk-go/README.md">Go SDK</a></td>
    <td>Language-specific guides</td>
  </tr>
  <tr>
    <td><a href="https://deepwiki.com/browserbase/stagehand">Ask DeepWiki</a></td>
    <td>Ask questions about this codebase</td>
  </tr>
</table>

## Join the community

Stagehand is built in the open, and the fastest way to shape it is to show up.

- **[⭐ Star this repo](https://github.com/browserbase/stagehand/stargazers)** — it is how most people find Stagehand
- **[💬 Join the Discord](https://discord.gg/stagehand)** — questions, support, and what we are building next
- **[🐛 Open an issue](https://github.com/browserbase/stagehand/issues)** — bug reports are the most useful contribution
- **[𝕏 Follow @stagehanddev](https://x.com/stagehanddev)** — releases and demos

### Contributing

We're focused on improving reliability, extensibility, speed, and cost, in that order. **Bug fixes and small improvements are the best way to get started.** For anything larger, reach out to [Miguel Gonzalez](https://x.com/miguel_gonzf) or [Paul Klein](https://x.com/pk_iv) on [Discord](https://discord.gg/stagehand) first so we can make sure it lands.

Stagehand is a TypeScript, Python, and Go monorepo driven by [`just`](https://github.com/casey/just):

```bash
git clone https://github.com/browserbase/stagehand.git
cd stagehand
just install
just generate
just build

export OPENAI_API_KEY="your-openai-api-key"
just example act # runs packages/sdk-ts/examples/act.ts
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full TypeScript, Python, and Go setup.

## Acknowledgements

We'd like to thank the following people for their major contributions to Stagehand:

- [Paul Klein](https://github.com/pkiv)
- [Sean McGuire](https://github.com/seanmcguire12)
- [Miguel Gonzalez](https://github.com/miguelg719)
- [Sameel Arif](https://github.com/sameelarif)
- [Thomas Katwan](https://github.com/tkattkat)
- [Filip Michalsky](https://github.com/filip-michalsky)
- [Anirudh Kamath](https://github.com/kamath)
- [Jeremy Press](https://x.com/jeremypress)
- [Navid Pour](https://github.com/navidpour)
- [Nick Sweeting](https://github.com/pirate)
- [Sam Finton](https://github.com/monadoid)
- [Shrey Pandya](https://github.com/shrey150)
- [Shriya Lolabattu](https://github.com/shriyatheunicorn)
- [Alyssa Maruyama](https://github.com/akeimach)

## License

Licensed under the MIT License.

Copyright 2026 Browserbase, Inc.

"Stagehand" is a trademark of Browserbase, Inc.
