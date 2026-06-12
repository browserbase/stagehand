<div align="center">

# >_ browse

### The single CLI your AI agents need to access the internet reliably.

[![npm version](https://img.shields.io/npm/v/browse.svg?style=flat-square&color=000000)](https://www.npmjs.com/package/browse)
[![npm downloads](https://img.shields.io/npm/dm/browse.svg?style=flat-square&color=000000)](https://www.npmjs.com/package/browse)
[![license](https://img.shields.io/badge/license-MIT-000000?style=flat-square)](https://github.com/browserbase/stagehand/blob/main/packages/cli/LICENSE)

```bash
npm install -g browse
```

<img src="https://github.com/browserbase/stagehand/blob/main/packages/cli/media/browse.gif?raw=true" alt="browse CLI demo" width="100%" />

</div>

---

`browse` gives any agent — or any terminal — a reliable way to drive a real browser, learn how to use specific websites, and tap into Browserbase's cloud. One command to navigate the open web, capture telemetry while you do it, and reuse skills the community has already built.

## Why browse

- **Browser interactions** — Navigate tricky, complex websites with `browse click`, `browse mouse scroll`, `browse type`, `browse select`, and 30+ more DOM commands.
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

## How it works

`browse` runs a lightweight per-session daemon. The first command starts it, and subsequent commands reuse the same browser — so cookies, tabs, and snapshot refs persist between invocations. Run multiple isolated browsers at once with `--session <name>` (or the `BROWSE_SESSION` env var), and shut a session down with `browse stop`.

### Browser targets

Every driver command accepts the same flags to pick where the browser runs. Mix and match per command:

| Flag | Target |
|------|--------|
| _(default)_ | Managed local browser, or remote when `BROWSERBASE_API_KEY` is set |
| `--local` | Managed local browser (add `--headed` / `--headless`) |
| `--remote` | Remote Browserbase session (uses `BROWSERBASE_API_KEY`) |
| `--auto-connect` | Auto-discover and attach to a local Chrome with remote debugging enabled |
| `--cdp <url\|port>` | Attach directly to a CDP endpoint (port, `http(s)://`, or `ws(s)://`) |
| `--target-id <id>` | Select a specific CDP target when attaching to an existing browser |
| `--chrome-arg <flag>` | Append a Chrome launch arg on top of the defaults (repeatable, managed-local only) |
| `--ignore-default-chrome-arg <flag>` | Drop a specific Chrome default launch arg (repeatable, managed-local only) |
| `--no-default-chrome-args` | Launch without any of Chrome's default args (managed-local only) |

```bash
browse open https://example.com                 # default target
browse open https://example.com --local --headed
browse open https://example.com --local --headed --chrome-arg=--no-focus-on-navigate
browse open https://example.com --remote
browse open https://example.com --auto-connect
browse open https://example.com --cdp 9222
browse open https://example.com --cdp ws://127.0.0.1:9222/devtools/browser/<id> --target-id <target-id>
```

Run `browse doctor` to diagnose session and browser-connection prerequisites for any target.

## Commands

### Navigation

```bash
browse open <url>     # Open a URL (--wait load|domcontentloaded|networkidle, --timeout <ms>)
browse reload         # Reload the active page
browse back           # Navigate backward
browse forward        # Navigate forward
```

### Snapshot & refs

The accessibility snapshot is the recommended way for agents to discover elements. It prints a tree of refs like `@0-12` that the element commands accept directly.

```bash
browse snapshot                 # Accessibility snapshot + cached refs
browse snapshot --compact       # Tree only, no ref maps
browse snapshot --filter submit # Filter lines by text or /regex/, keeping ancestors
browse snapshot --max-depth 4   # Trim output deeper than this depth
browse refs                     # Show refs cached from the last snapshot
```

### Element actions

Targets accept a snapshot ref (`@0-12`), an XPath, or a CSS selector.

```bash
browse click @0-12                          # Click (also accepts selectors)
browse fill @0-8 "hello"                     # Fill an input (--press-enter to submit)
browse select @0-9 "CA"                       # Select an option (--value for <option value>)
browse type "hello world"                     # Type at the current focus (--delay, --mistakes)
browse press Enter                            # Press a key (alias: browse key) e.g. Meta+K, Escape
browse upload @0-4 ./resume.pdf               # Upload file(s) (repeat --file for more)
browse highlight @0-12                         # Highlight an element (--duration <ms>)
```

### Mouse (raw coordinates)

Use these when you need pixel coordinates instead of a ref. Add `--return-xpath` to get the XPath under the cursor.

```bash
browse mouse click 240 320      # Click coordinates (--button, --click-count)
browse mouse hover 240 320      # Move the mouse
browse mouse scroll 400 500 0 600   # Scroll from a point by (dx, dy)
browse mouse drag 100 100 400 400   # Drag between two points (--steps, --delay)
```

### Page info & state

```bash
browse get url          # Read page data / element state:
browse get title        #   url, title, text, html, value, box,
browse get text @0-12   #   visible, checked, markdown
browse get markdown body
browse get box 'button[type=submit]'
browse is visible @0-12       # Check element state: visible, checked
browse eval 'document.title'  # Evaluate JavaScript in the page
browse viewport 1280 720      # Set viewport size (--scale for device pixel ratio)
browse cursor                 # Enable a visible cursor overlay
browse screenshot --path page.png   # Screenshot (--full-page, --type, --quality, --clip)
```

### Waiting

```bash
browse wait load                          # Wait for a load state
browse wait load networkidle --timeout 45000
browse wait selector @0-12 --state visible  # visible|hidden|attached|detached
browse wait timeout 1000                  # Wait a fixed number of ms
```

### Tabs

```bash
browse tab list             # List tabs (with stable targetIds)
browse tab new [url]        # Open a new tab and make it active
browse tab switch <target-id>  # Switch active tab (index or targetId)
browse tab close [target-id]   # Close a tab (defaults to the active tab)
```

Prefer the `targetId` from `browse tab list` over the index for stable agent workflows.

### Network capture

Capture request/response traffic for the active session to a local directory.

```bash
browse network on       # Start capturing
browse network off      # Stop capturing
browse network path     # Print the capture directory
browse network clear    # Clear captured requests
```

> [!NOTE]
> `browse network on` writes request/response headers and bodies to a local owner-only capture directory. These files can include cookies, authorization headers, and other secrets — use network capture only on trusted machines and run `browse network clear` when done.

### Session & daemon

```bash
browse status      # Show daemon status for a session
browse stop        # Stop the daemon (--force to kill an unresponsive browser)
browse doctor      # Diagnose session and browser-connection prerequisites
browse cdp 9222    # Attach to a CDP endpoint and stream DevTools events (--domain, --pretty)
```

### Global flags

These apply across driver commands:

| Flag | Description |
|------|-------------|
| `-s, --session <name>` | Named browser session (or `BROWSE_SESSION` env var) |
| `--local` / `--remote` | Choose a managed local or remote Browserbase browser |
| `--headed` / `--headless` | Window visibility for managed local sessions |
| `--auto-connect` | Attach to a local Chrome with remote debugging enabled |
| `--cdp <url\|port>` | Attach directly to a CDP endpoint |
| `--target-id <id>` | Select a specific CDP target |
| `--json` | Emit machine-readable JSON (available on most commands) |

## Open web skills catalog

Use [browse.sh](https://browse.sh), the largest open-source catalog of skills to reliably perform any task on the internet. Find a specialized skill to navigate `apartments.com`, for example, and drastically reduce your agent's time and token costs.

```bash
browse skills install                                       # install the bundled browse CLI skill
browse skills list                                          # list the public Browse.sh catalog
browse skills list --all                                    # include every catalog entry
browse skills find reviews                                  # search by slug, domain, title, tag…
browse skills find yelp.com/extract-reviews
browse skills add yelp.com/extract-reviews                  # install a catalog skill
browse skills add mcdonalds.order.online/order-delivery-42q71n
```

## Browserbase cloud commands

Manage projects, sessions, contexts, and extensions, or call the Fetch and Search APIs directly. These commands use `BROWSERBASE_API_KEY`.

```bash
# Projects
browse cloud projects list
browse cloud projects get <project-id>
browse cloud projects usage <project-id>

# Sessions
browse cloud sessions list                       # --limit, --status, --json
browse cloud sessions get <session-id>
browse cloud sessions create                     # --proxies, --verified, --region, --solve-captchas…
browse cloud sessions update <session-id> --status REQUEST_RELEASE
browse cloud sessions debug <session-id>         # live debugger URLs
browse cloud sessions logs <session-id>
browse cloud sessions downloads get <session-id> # --output ./downloads.zip
browse cloud sessions uploads create <session-id> ./file.pdf

# Contexts
browse cloud contexts create
browse cloud contexts get <context-id>
browse cloud contexts update <context-id>        # refresh the upload URL
browse cloud contexts delete <context-id>

# Extensions
browse cloud extensions upload ./extension.zip
browse cloud extensions get <extension-id>
browse cloud extensions delete <extension-id>

# Fetch & Search APIs
browse cloud fetch <url>                          # markdown by default
browse cloud search <query>
```

`browse cloud fetch` returns markdown-formatted page content by default. Use `--format raw` for the original response body, or `--format json --schema <schema>` for structured extraction.

## Functions

Browserbase [Functions](https://docs.browserbase.com/platform/runtime/overview) let you deploy browser agents and automation scripts directly onto Browserbase's infrastructure. Build locally, test instantly, and deploy as APIs.

```bash
browse functions init my-function          # scaffold a new project (--package-manager)
browse functions dev index.ts              # local development server (--port, --verbose)
browse functions publish index.ts          # package and upload (--dry-run to preview)
browse functions invoke <function-id> --params '{"url":"https://example.com"}'
browse functions invoke --check-status <invocation-id>
```

## Templates

Discover and scaffold ready-to-run Browserbase example projects.

```bash
browse templates list                      # --tag, --source, --wide, --json
browse templates find amazon               # search by slug, title, category, or tag
browse templates clone google-trends-keywords
browse templates clone amazon-product-scraping --language python ./my-scraper
```

## Configuration

Set your Browserbase API key to enable remote sessions and cloud commands:

```bash
export BROWSERBASE_API_KEY=bb_live_...
```

Local driver commands (`--local`) work without an API key.

| Variable | Description |
|----------|-------------|
| `BROWSERBASE_API_KEY` | Enables `--remote` sessions and all `browse cloud` / `functions` commands |
| `BROWSE_SESSION` | Default session name (alternative to `-s, --session`) |

## Links

- [browse.sh](https://browse.sh) — open web skills catalog
- [Browserbase docs](https://docs.browserbase.com)
- [GitHub](https://github.com/browserbase/stagehand/tree/main/packages/cli) · [Issues](https://github.com/browserbase/stagehand/issues)

## License

[MIT](https://github.com/browserbase/stagehand/blob/main/packages/cli/LICENSE)
