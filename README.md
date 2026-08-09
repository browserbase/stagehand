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
  <a href="https://stagehand.dev/discord">
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

Stagehand is the SDK for browser agents. Playwright was built for testing, Stagehand is built for agents. Use familiar APIs, self-healing actions, and network-level security across TypeScript, Python, and Go.

## Why Stagehand?

Stagehand gives browser agents an interface built for how they actually work. It combines familiar Playwright-style APIs with self-healing actions, agent-optimized page context, and native support for complex DOM structures like out-of-process iframes and closed Shadow DOMs.

Agents use fewer tokens, recover when websites change, and complete tasks more reliably. With a complete browser driver across TypeScript, Python, and Go, Stagehand delivers the flexibility of AI without sacrificing the speed, control, determinism, reliability, and observability required in production.

### 1. Familiar APIs

The Playwright-style methods you and your agents already know and love (`goto`, `click`, `locator`, `screenshot`).

### 2. Token efficiency as a priority

Stagehand's hybrid accessibility tree trimming gives your agents exactly what they need to understand the page and nothing more.

### 3. Faster in production

Stagehand runs as an extension next to the browser, closing the distance and reducing round-trip latency for all actions on the page.

### 4. Self-healing primitives

Use `act`, `observe`, and `extract` with natural language to automate pages. When sites change, Stagehand detects it and refreshes how the actions happen on the page automatically.

### 5. Features agents need

WebMCP, clipboard support, self-healing actions, batch commands, deep locators for nested iframes, and OTel support.

## Getting Started

Check out our [Quickstart Guide](https://docs.stagehand.dev/v4/first-steps/quickstart) for more information:

## Example

Here's how to build a sample browser automation with Stagehand:

```typescript
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

const browser = await browserbase.launch();
const stagehand = await Stagehand.create({ browser });

// Stagehand's CDP engine provides an optimized, low level interface to the browser built for automation
const page = await browser.context.pages()[0];
await page.goto("https://github.com/browserbase");

// Use act() to execute individual actions
await stagehand.act("click on the stagehand repo");

// Use observe() to see what's actionable on the page
const { data: actions } = await stagehand.observe("find the latest PR");

// Use locators for deterministic Playwright-style actions
await page.locator(actions[0].selector).click();

// Use extract() to get structured data from the page
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

## Documentation

Visit [docs.stagehand.dev](https://docs.stagehand.dev) to view the full documentation.

### Build and Run from Source

```bash
git clone https://github.com/browserbase/stagehand.git
cd stagehand
pnpm install
pnpm run build
pnpm run example # run the blank script at ./examples/example.ts
```

Stagehand is best when you have an API key for an LLM provider and Browserbase credentials. To add these to your project, run:

```bash
cp .env.example .env
nano .env # Edit the .env file to add API keys
```

### Installing from a branch

To install Stagehand directly from a GitHub branch, install the core package subdirectory:

```bash
pnpm add "github:browserbase/stagehand#<branchName>&path:/packages/core"
```

Or set it in your project's `package.json`:

```json
"@browserbasehq/stagehand": "github:browserbase/stagehand#<branchName>&path:/packages/core"
```

## Contributing

> [!NOTE]
> We highly value contributions to Stagehand! For questions or support, please join our [Discord community](https://stagehand.dev/discord).

We're focused on improving reliability, extensibility, speed, and cost in that order of priority. If you're interested in contributing, **bug fixes and small improvements are the best way to get started**. For more involved features, we strongly recommend reaching out to [Miguel Gonzalez](https://x.com/miguel_gonzf) or [Paul Klein](https://x.com/pk_iv) in our [Discord community](https://stagehand.dev/discord) before starting to ensure that your contribution aligns with our goals.

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
- [Alyssa Maruyama](https://github.com/akeimach)

## License

Licensed under the MIT License.

Copyright 2026 Browserbase, Inc.

"Stagehand" is a trademark of Browserbase, Inc.
