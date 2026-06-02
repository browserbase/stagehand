<div align="center">

# >_ browse

### The single CLI your AI agents need to access the internet reliably.

[![npm version](https://img.shields.io/npm/v/browse.svg?style=flat-square&color=000000)](https://www.npmjs.com/package/browse)
[![npm downloads](https://img.shields.io/npm/dm/browse.svg?style=flat-square&color=000000)](https://www.npmjs.com/package/browse)
[![license](https://img.shields.io/npm/l/browse.svg?style=flat-square&color=000000)](https://github.com/browserbase/stagehand/blob/main/packages/cli/LICENSE)

```bash
npm install -g browse
```

<img src="https://github.com/browserbase/stagehand/blob/main/packages/cli/media/browse.gif" alt="browse CLI demo" width="100%" />

</div>

---

`browse` gives any agent — or any terminal — a reliable way to drive a real browser, learn how to use specific websites, and tap into Browserbase's cloud. One command to navigate the open web, capture telemetry while you do it, and reuse skills the community has already built.

## Why browse

- **Browser interactions** — Navigate tricky, complex websites with `browse click`, `browse mouse scroll`, `browse type`, `browse select`, and 20+ more DOM commands.
- **Open web skills catalog** — `browse` is the official CLI for [browse.sh](https://browse.sh), the largest open web catalog. Run `browse skills add apartments.com` and your agent learns how to use that site and its APIs.
- **Rich debugging** — Arm your agents with network, console, and other web telemetry.
- **Cloud features** — Optionally use Browserbase cloud: load cookies via saved [Contexts](https://docs.browserbase.com/platform/browser/core-features/contexts), use [Verified Browsers](https://www.browserbase.com/verified), and call the [Fetch and Search APIs](https://www.browserbase.com/search).

## Quick start

```bash
npm install -g browse

browse open https://example.com
browse snapshot --compact
browse click @0-12
browse fill @0-8 "hello"
browse get title
browse screenshot --path page.png
browse stop
```

## Driver commands

Drive a real browser from the terminal — locally, over CDP, or on a remote Browserbase session.

```bash
browse open https://example.com
browse open https://example.com --local --headed
browse open https://example.com --remote
browse open https://example.com --auto-connect
browse open https://example.com --cdp 9222
browse open https://example.com --cdp ws://127.0.0.1:9222/devtools/browser/<id> --target-id <target-id>
browse snapshot --compact
browse click @0-12
browse fill @0-8 "hello"
browse mouse click 240 320
browse get title
browse screenshot --path page.png
browse tab list
browse tab switch <target-id>
browse network on
browse cdp 9222 --pretty
browse status
browse stop
```

Use `--local`, `--remote`, `--auto-connect`, or `--cdp <url|port>` per command to choose the browser target. Use `--target-id <id>` with `--cdp` when attaching to a specific CDP target. Driver commands use `BROWSERBASE_API_KEY` for remote Browserbase sessions.

> [!NOTE]
> `browse network on` writes request/response headers and bodies to a local owner-only capture directory. These files can include cookies, authorization headers, and other secrets — use network capture only on trusted machines and run `browse network clear` when done.

## Open web skills catalog

Use [browse.sh](https://browse.sh), the largest open-source catalog of skills to reliably perform any task on the internet. Find a specialized skill to navigate `apartments.com`, for example, and drastically reduce your agent's time and token costs.

```bash
browse skills install                                       # install the bundled browse CLI skill
browse skills list                                          # list the public Browse.sh catalog
browse skills find reviews                                  # search by slug, domain, title, tag…
browse skills find yelp.com/extract-reviews
browse skills add yelp.com/extract-reviews                  # install a catalog skill
browse skills add mcdonalds.order.online/order-delivery-42q71n
```

## Browserbase cloud commands

Manage projects, sessions, contexts, and extensions, or call the Fetch and Search APIs directly.

```bash
browse cloud projects list
browse cloud projects get <project-id>
browse cloud projects usage <project-id>
browse cloud sessions list
browse cloud sessions get <session-id>
browse cloud sessions create
browse cloud sessions debug <session-id>
browse cloud sessions logs <session-id>
browse cloud sessions downloads get <session-id>
browse cloud sessions uploads create <session-id> <file>
browse cloud contexts create
browse cloud contexts get <context-id>
browse cloud extensions upload <file>
browse cloud fetch <url>
browse cloud search <query>
```

`browse cloud fetch` returns markdown-formatted page content by default. Use `--format raw` for the original response body, or `--format json --schema <schema>` for structured extraction.

## Functions

Browserbase [Functions](https://docs.browserbase.com/platform/runtime/overview) let you deploy browser agents and automation scripts directly onto Browserbase's infrastructure. Build locally, test instantly, and deploy as APIs.

```bash
browse functions init my-function
browse functions dev index.ts
browse functions publish index.ts
browse functions publish index.ts --dry-run
browse functions invoke <function-id> --params '{"url":"https://example.com"}'
browse functions invoke --check-status <invocation-id>
```

## Configuration

Set your Browserbase API key to enable remote sessions and cloud commands:

```bash
export BROWSERBASE_API_KEY=bb_live_...
```

Local driver commands (`--local`) work without an API key.

## Links

- [browse.sh](https://browse.sh) — open web skills catalog
- [Browserbase docs](https://docs.browserbase.com)
- [GitHub](https://github.com/browserbase/stagehand/tree/main/packages/cli) · [Issues](https://github.com/browserbase/stagehand/issues)

## License

[MIT](https://github.com/browserbase/stagehand/blob/main/packages/cli/LICENSE)
