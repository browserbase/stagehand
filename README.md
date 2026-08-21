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
  <strong>Stagehand is the SDK for browser agents.</strong><br>
  <a href="https://docs.stagehand.dev">Read the Docs</a>
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
</p>

<p align="center">
	<a href="https://trendshift.io/repositories/12122" target="_blank"><img src="https://trendshift.io/api/badge/repositories/12122" alt="browserbase%2Fstagehand | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="https://deepwiki.com/browserbase/stagehand">
    <img alt="Ask DeepWiki" src="https://deepwiki.com/badge.svg" />
  </a>
</p>

## What is Stagehand?

Stagehand is an SDK for browser agents. It combines familiar browser-control APIs with AI primitives that recover when websites change. Build with TypeScript, Python, or Go.

## Why Stagehand?

Stagehand gives agents the browser interface they need in production. It combines Playwright-style APIs with self-healing actions, agent-optimized page context, and support for out-of-process iframes and closed Shadow DOMs.



### Familiar APIs

Use the browser-control methods you already know, including `goto`, `click`, `locator`, and `screenshot`.

### Token-efficient page context

Hybrid accessibility-tree trimming gives agents the page context they need without sending the full DOM.

### Low-latency execution

Stagehand runs as an extension beside the browser, which reduces round-trip latency for page actions.

### Self-healing primitives

Use `act`, `observe`, and `extract` to automate pages with natural language. When a site changes, Stagehand refreshes the action path automatically.

### Agent-ready features

Use WebMCP, clipboard support, batch commands, deep locators for nested iframes, and OpenTelemetry support.

## Getting started

Start with the [Quickstart guide](https://docs.stagehand.dev/v4/first-steps/quickstart), then try the example below.

## Example

This example opens Browserbase's GitHub organization, finds the latest Stagehand PR, and extracts its author and title.

```typescript
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

const { BROWSERBASE_API_KEY, OPENAI_API_KEY } = process.env;

const browser = await browserbase.launch({
  apiKey: BROWSERBASE_API_KEY,
});

const stagehand = await Stagehand.create({
  browser,
  model: {
    modelName: "openai/gpt-5.4-mini",
    apiKey: OPENAI_API_KEY,
  },
});

// Use the browser's CDP interface directly when you need deterministic control.
const [page] = await browser.context.pages();
await page.goto("https://github.com/browserbase");

// Execute an action with natural language.
await stagehand.act("click on the stagehand repo");

// Inspect actions before choosing one.
const { data: actions } = await stagehand.observe("find the latest PR");

// Use the returned locator for deterministic control.
await page.locator(actions[0].selector).click();

// Extract typed data from the page.
const {
  data: { author, title },
} = await stagehand.extract(
  "extract the author and title of the PR",
  z.object({
    author: z.string().describe("The username of the PR author"),
    title: z.string().describe("The title of the PR"),
  }),
);
```

See the [Python](./packages/sdk-python/README.md) and [Go](./packages/sdk-go/README.md) READMEs for equivalent examples.

## Documentation

Visit [docs.stagehand.dev](https://docs.stagehand.dev) to view the full documentation.

### Build and run from source

Stagehand is a TypeScript, Python, and Go monorepo. We use [`just`](https://github.com/casey/just) to drive `pnpm`, `uv`, and `go` together.

```bash
git clone https://github.com/browserbase/stagehand.git
cd stagehand
just install
just generate
just build
```

The TypeScript examples use an LLM provider API key and Browserbase credentials. Export the following values before running an example.

```bash
export OPENAI_API_KEY="your-openai-api-key"
export BROWSERBASE_API_KEY="your-browserbase-api-key"
```

Run an example from [`packages/sdk-ts/examples`](./packages/sdk-ts/examples).

```bash
just example act # runs packages/sdk-ts/examples/act.ts
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full TypeScript, Python, and Go setup.

## Contributing

> [!NOTE]
> We welcome contributions. For questions or support, join our [Discord community](https://discord.gg/stagehand).

We prioritize reliability, extensibility, speed, and cost, in that order. Start with bug fixes or small improvements. Before beginning a larger feature, reach out to [Miguel Gonzalez](https://x.com/miguel_gonzf) or [Paul Klein](https://x.com/pk_iv) in our [Discord community](https://discord.gg/stagehand) to align on the approach.

<!-- For more information, please see our [CONTRIBUTING.md](CONTRIBUTING.md) -->

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
