# pi + Stagehand facade (native tools)

[pi](https://pi.dev) has no built-in MCP by design — extensions register tools directly. This
package is a pi extension exposing the Stagehand facade tools (`run`, `snapshot`,
`screenshot`) natively, with descriptions, validation, and agent guidance imported from
`@browserbasehq/stagehand-integrations/facade`.

## Setup

Use Node.js 24 or later. From the repository root, build the integrations package first:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
```

Export the browser credentials (Browserbase is the default and recommended backend) and a model
key pi supports:

```bash
export BROWSERBASE_API_KEY=bb_live_...
export BROWSERBASE_PROJECT_ID=...
export OPENAI_API_KEY=sk-...   # or ANTHROPIC_API_KEY
```

## Run

One-off, pointing pi at the extension file (no install needed; pi loads TypeScript directly and
resolves `@browserbasehq/stagehand-integrations` through the workspace):

```bash
cd packages/integrations/pi
pi -e ./extensions/stagehand.ts --no-session -p "Use your browser tools: open https://example.com, snapshot it, and report the heading citing the snapshot ID." </dev/null
```

Two headless gotchas: print mode reads piped stdin (always redirect `</dev/null`), and
non-interactive runs never show the project-trust prompt — use `-e` as above, or `-a` after
trusting the project.

To install permanently instead: `pi install ./packages/integrations/pi` (the `pi` manifest key
in `package.json` points at the extension).

## Security model

The `run` tool executes model-authored JavaScript inside the Stagehand browser extension's
service worker — browser-side, never in the pi process. Browserbase is the recommended
isolation boundary: the privileged execution environment is a disposable cloud browser. The
browser launches lazily on first tool use and closes on session shutdown; only
`STAGEHAND_*`/`BROWSERBASE_*` variables configure it, and pi's model credentials never reach
the browser session.
