---
name: browse
description: Use the browse CLI for Browserbase browser automation, Browserbase cloud APIs, Browserbase Functions, templates, web fetch/search, diagnostics, and Browse.sh skill discovery/installation. Use when the user asks to navigate pages, inspect browser state, run local or remote browser sessions, manage Browserbase resources, call Browserbase Functions, browse or scaffold Browserbase templates, fetch or search web content, diagnose browse setup, find or install a skill for a website task, discover site-specific Browse.sh skills, or install/refresh this browse skill.
compatibility: "Requires the browse CLI (`npm install -g browse`). Remote Browserbase sessions and cloud API commands require `BROWSERBASE_API_KEY`. Local mode uses Chrome/Chromium on the machine."
license: MIT
allowed-tools: Bash
metadata:
  openclaw:
    requires:
      bins:
        - browse
    install:
      - kind: node
        package: browse
        bins: [browse]
    homepage: https://github.com/browserbase/stagehand/tree/main/packages/cli
---

# Browse CLI

Use `browse` as the primary Browserbase command-line interface.

It can:

- drive a local or Browserbase-hosted browser session
- inspect pages through accessibility snapshots, screenshots, DOM/text reads, and network capture
- interact with pages by refs, selectors, XPath, keyboard, mouse, files, and viewport controls
- manage Browserbase projects, sessions, contexts, extensions, fetch, and search APIs
- develop, publish, and invoke Browserbase Functions
- browse and scaffold Browserbase templates
- diagnose local or remote browser setup issues
- discover and install Browse.sh catalog skills
- install or refresh this Browse CLI skill

## Setup Check

Verify the CLI exists before relying on it:

```bash
which browse || npm install -g browse
browse --help
```

Install or refresh this skill with:

```bash
browse skills install
```

Use `browse <topic> --help` for exact flags before running unfamiliar commands.

## Browser Target Selection

Browser driver commands auto-start the browse daemon when needed. Choose the browser target per command with flags:

```bash
browse open https://example.com --local
browse open https://example.com --local --headed
browse open https://example.com --remote
browse open https://example.com --auto-connect
browse open https://example.com --cdp 9222
browse open https://example.com --cdp ws://127.0.0.1:9222/devtools/browser/<id>
```

Use local mode for development, localhost, trusted sites, and fast iteration. Use `--auto-connect` only when the user explicitly wants to attach to an already-running debuggable Chrome session with existing cookies or login state; use `--local` when no debuggable Chrome is available. Use remote mode when Browserbase credentials are available and the site needs hosted browser infrastructure, Verified browser mode, CAPTCHA solving, proxies, or session persistence.

Choose headed/headless and local/remote mode when starting a session. A running session keeps its mode: passing a conflicting flag such as `--headed` to an already-running headless session fails until you run `browse stop --session <name>` or target a different session.

Use named sessions for any non-trivial work, especially when multiple agents or parallel tasks may run at once. Every browser command accepts `--session <name>` (or `-s <name>`); the `BROWSE_SESSION` env var sets the default, and commands without either share the `default` session.

```bash
browse open https://example.com --session research --local
browse snapshot --session research
```

Remote browser and cloud API commands require:

```bash
export BROWSERBASE_API_KEY=...
```

## Browser Automation Workflow

Start by opening the page, then inspect state, act, and verify.

```bash
browse open https://example.com --session research --local
browse snapshot --session research
browse click @0-5 --session research
browse type "hello" --session research
browse snapshot --session research
browse stop --session research
```

Prefer `browse snapshot` over screenshots for most browser work. It is structured, fast, and returns refs like `@0-5` for reliable element interaction. Use screenshots when visual layout, images, or pixel-level state matter.

Refs are refreshed on every snapshot. After clicks, form submits, navigation, or UI re-renders, take a new snapshot before using another ref.

## Parallel Browser Work

Use a different `--session` value for each independent browser task. Sessions isolate tabs, cookies, refs, and daemon state; parallel tasks that omit `--session` share the `default` session and overwrite each other's active page.

```bash
browse open https://example.com/search-a --session search-a --local
browse open https://example.com/search-b --session search-b --local
browse snapshot --session search-a
browse snapshot --session search-b
```

When a task is complete, stop only that task's session:

```bash
browse stop --session search-a
```

## Core Browser Commands

Navigation:

```bash
browse open <url>
browse reload
browse back
browse forward
browse wait load
browse wait selector "#result"
```

Page state:

```bash
browse snapshot
browse snapshot --compact
browse refs
browse get url
browse get title
browse get text body
browse get html "#main"
browse get value "#email"
browse get markdown body                   # page/element content as markdown
browse eval "document.title"              # run JavaScript in the active page
browse screenshot                         # print base64 JSON
browse screenshot --path page.png
```

Interaction:

```bash
browse click @0-5
browse fill @0-8 "search query"
browse type "text for the focused element"
browse press Enter
browse select "select[name=country]" "United States"
browse upload @0-12 ./file.pdf
browse highlight @0-5
browse is visible "#modal"
```

Mouse and viewport:

```bash
browse mouse click 240 320
browse mouse hover 240 320
browse mouse drag 80 80 310 100
browse mouse scroll 500 300 0 600
browse viewport 1280 720
browse cursor                             # show a visible cursor overlay
```

Tabs, network, and CDP:

```bash
browse tab list
browse tab new https://example.com
browse tab switch <target-id>
browse tab close <target-id>              # refuses to close the last tab
browse network on
browse network off
browse network path
browse network clear
browse cdp 9222 --pretty
```

Session management:

```bash
browse doctor
browse doctor --json
browse status
browse stop
browse stop --force
```

Use `browse doctor` before debugging a broken browser session. Use `browse doctor --json` when another agent or CI needs structured diagnostics.

If a page command reports that no active page is available, inspect and recover the named session:

```bash
browse status --session research
browse tab list --session research
browse tab new https://example.com --session research
browse open https://example.com --session research
```

## Cloud APIs

Use `browse cloud` for Browserbase platform APIs:

```bash
browse cloud projects list
browse cloud projects get <project-id>
browse cloud projects usage <project-id>
browse cloud sessions create
browse cloud sessions create --proxies --verified
browse cloud sessions list
browse cloud sessions get <session-id>
browse cloud sessions update <session-id>
browse cloud sessions debug <session-id>
browse cloud sessions logs <session-id>
browse cloud sessions downloads get <session-id>
browse cloud sessions uploads create <session-id> ./file.pdf
browse cloud contexts create
browse cloud contexts get <context-id>
browse cloud contexts update <context-id>
browse cloud contexts delete <context-id>
browse cloud extensions upload ./extension.zip
browse cloud extensions get <extension-id>
browse cloud extensions delete <extension-id>
browse cloud fetch https://example.com
browse cloud search "browser automation"
```

For remote sessions with context persistence:

```bash
browse cloud sessions create --context-id <context-id> --persist
```

Use `--verified` when the task needs Browserbase Verified browser mode.

Use `browse cloud fetch` when the user needs a simple HTTP fetch without browser interaction. It returns markdown-formatted page content by default; pass `--format raw` for the original response body or `--format json --schema <schema>` for structured extraction. Use `browse cloud search` when the user asks for web search results.

## Browserbase Functions

Use `browse functions` to create, develop, publish, and invoke Browserbase Functions:

```bash
browse functions init my-function
browse functions dev index.ts
browse functions publish index.ts
browse functions publish index.ts --dry-run
browse functions invoke <function-id> --params '{"url":"https://example.com"}'
browse functions invoke --check-status <invocation-id>
```

Functions commands use `BROWSERBASE_API_KEY`. Generated projects import `defineFn` from `@browserbasehq/sdk-functions`.

## Templates

Use `browse templates` to discover and scaffold Browserbase starter templates:

```bash
browse templates list
browse templates list --tag Python --source Browserbase
browse templates find google-trends-keywords
browse templates find amazon --json
browse templates clone google-trends-keywords
browse templates clone amazon-product-scraping --language python ./my-scraper
browse templates clone dynamic-form-filling ./form-bot --language typescript
```

Use `browse templates find` before cloning when the exact slug is uncertain. Use `--language typescript` or `--language python` to choose the generated project runtime when a template supports both.

## Skills

Install or refresh this bundled CLI skill:

```bash
browse skills install
```

### Discovering Browse.sh Skills

Browse.sh (https://browse.sh) is a catalog of site-specific browser automation skills. Each skill is scoped to one task on one website and identified by a `<domain>/<task>` slug. An installed skill encodes a proven strategy for that site — API endpoints, selectors, anti-bot handling — so it completes the task faster and more reliably than exploring the site from scratch.

Search the catalog proactively when:

- the user asks to complete a task on a specific website — search the domain before automating it by hand
- the user asks for a task in a common category like flights, food delivery, reviews, recipes, tickets, jobs, or shopping — search the keyword
- the user asks "is there a skill for X" or wants new capabilities

```bash
browse skills list                              # browse the catalog
browse skills find <query>                      # search by slug, domain, title, description, category, alias, or tag
browse skills add <domain>/<task>               # install an exact slug
```

### Search Strategy

Search the domain first, then the task, then broaden:

```bash
browse skills find yelp.com                     # 1. exact domain
browse skills find yelp                         # 2. site name
browse skills find reviews                      # 3. task keyword
browse skills find "restaurant reviews"         # 4. multi-word query
browse skills find food --limit 5               # 5. category keyword, capped
```

- Querying an exact slug (`browse skills find yelp.com/extract-reviews-2ikb22`) prints a detail view with the full description and install command.
- If a search returns nothing, try synonyms (`flights` vs `travel`, `food` vs `restaurants`) before concluding no skill exists.
- Each result shows a recommended method — `api`, `fetch`, `browser`, or `hybrid` — indicating how the skill drives the site. Install counts signal which skills are proven.
- Many slugs end in a generated suffix (`-2ikb22`), so never guess or construct them. Install only with an exact slug copied from `list` or `find` output: `browse skills add yelp.com/extract-reviews-2ikb22`. The installed skill becomes available to the agent as a regular skill; a new agent session may be needed to pick it up.

### Output Formats

Output is a table in a terminal and JSON when piped, so agents get structured JSON by default. Force a format with `--format table|json` or `--json`.

```bash
browse skills find food --format table --limit 10
browse skills find food --json | jq -r '.skills[] | "\(.slug)\t\(.title)"'
```

JSON output includes every match with full descriptions and ignores `--limit`; `browse skills list --json` returns the entire catalog, which is large. Prefer `browse skills find <query>` to narrow first, or `--format table --limit <n>` for a compact view.

## Best Practices

1. Run the real command and inspect its output instead of guessing.
2. Use `browse snapshot` before interacting so you have current refs.
3. Re-run `browse snapshot` after navigation or DOM-changing actions because refs can change.
4. Prefer refs from snapshots for clicks and uploads; use selectors or XPath when refs are unavailable.
5. Use `--local` for localhost and repeatable development; use `--remote` for protected sites or Browserbase-specific behavior.
6. Use a distinct `--session <name>` for each parallel or long-running task; commands without the flag share the `default` session.
7. Use `--auto-connect` only when attaching to an existing debuggable local Chrome session is intended.
8. Use `browse doctor` when session startup, browser discovery, CDP attach, or Browserbase auth looks wrong.
9. Use `browse stop` (or `browse stop --session <name>`) when finished to clean up daemon state.
10. For unfamiliar command details, run `browse <topic> --help` and follow the exact dash-case flags.

## Troubleshooting

- "No active page": run `browse status --session <name>`, then `browse open <url> --session <name>` or `browse tab new <url> --session <name>`; use `browse stop --force` if the daemon is stale.
- Chrome not found: use `--remote` with Browserbase credentials, install Chrome, or attach with `--cdp`.
- Action fails: run `browse snapshot` and use a visible ref from the current page state.
- Remote command fails: verify `BROWSERBASE_API_KEY` and inspect `browse cloud projects list`.
- Session setup is unclear: run `browse doctor` or `browse doctor --json`.
- Protected site blocks local mode: retry with `--remote`.
- `browse skills find` returns nothing: broaden the query — bare domain, then site name, then a task keyword or synonym.
- `browse skills add` fails on `npx`: install Node.js from https://nodejs.org, then rerun.
- Newly added skill is not available: it installs for future sessions; list installed skills or start a new agent session.
