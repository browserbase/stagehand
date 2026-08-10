# Stagehand codemode integrations

Bring Stagehand's codemode browser tools to CrewAI, Deep Agents, Eve, Mastra, and the Vercel AI SDK. Every integration gives an agent the same small, stateful tool surface while keeping browser control inside Stagehand.

> [!IMPORTANT]
> These are experimental workspace integrations. Run them from this repository; the integration packages are not published as standalone adapters.

## What the agent gets

| Tool         | Use it to                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `run`        | Execute JavaScript against a Playwright-shaped `page`, `context`, and `browser`, or batch actions using IDs from the latest snapshot. |
| `snapshot`   | Read the active page's compact accessibility tree and hydrate element IDs for the next action.                                        |
| `screenshot` | Inspect the active page as a PNG or JPEG.                                                                                             |

The three tools share one persistent browser. Snapshot IDs belong to the latest snapshot of the active page, so take a new snapshot after navigation or when an ID becomes stale.

## Choose an integration

| Framework                              | Directory     | Connection                                        | Language   |
| -------------------------------------- | ------------- | ------------------------------------------------- | ---------- |
| [CrewAI](./crewai/README.md)           | `crewai/`     | MCP over stdio                                    | Python     |
| [Deep Agents](./deepagents/README.md)  | `deepagents/` | MCP over stdio locally; native tools when managed | Python     |
| [Eve](./eve/README.md)                 | `eve/`        | Native in-process tools                           | TypeScript |
| [Mastra](./mastra/README.md)           | `mastra/`     | MCP over stdio                                    | TypeScript |
| [Vercel AI SDK](./vercel-ai/README.md) | `vercel-ai/`  | MCP over stdio                                    | TypeScript |

Use the MCP examples when your framework already supports MCP and you want a portable tool contract. Use a native integration when you want one process and direct control over browser-session ownership.

The shared TypeScript implementation lives in `core/`. It provides both the in-process tools and the stdio MCP server used by the examples.

## Build from source

You need Node.js 24 or newer and pnpm 11.10.0. CrewAI and Deep Agents also require Python 3.11–3.13 and [uv](https://docs.astral.sh/uv/).

Local browser mode also needs a current Google Chrome installation. Browserbase mode does not launch a browser on the host.

From the repository root:

```bash
corepack pnpm@11.10.0 install --frozen-lockfile
corepack pnpm@11.10.0 exec turbo run build \
  --filter @browserbasehq/stagehand-integrations
```

Then open the README for your framework and run its quickstart.

## Configure Stagehand

The TypeScript integrations use these shared variables. Deep Agents uses `STAGEHAND_MODEL` instead of `STAGEHAND_MODEL_NAME`; see its README for the Python-specific configuration.

| Variable                     | Purpose                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `STAGEHAND_BROWSER`          | `local` or `browserbase`. Defaults to Browserbase when `BROWSERBASE_API_KEY` is set; otherwise defaults to local Chrome. |
| `STAGEHAND_HEADLESS`         | Set to `true` to run local Chrome without a visible window. Defaults to `false`.                                         |
| `STAGEHAND_CHROME_PATH`      | Optional path to a compatible Chrome executable for local mode.                                                          |
| `STAGEHAND_CHROMIUM_SANDBOX` | Set to `false` only when local Chrome runs inside an already isolated container. Defaults to `true`.                     |
| `BROWSERBASE_API_KEY`        | Required for the Browserbase backend.                                                                                    |
| `BROWSERBASE_PROJECT_ID`     | Optional Browserbase project ID.                                                                                         |
| `STAGEHAND_MODEL_NAME`       | Optional model for Stagehand AI methods called inside `run`.                                                             |
| `STAGEHAND_MODEL_API_KEY`    | Optional key for `STAGEHAND_MODEL_NAME`. The matching provider key is inferred when supported.                           |

Each framework has a separate variable for the agent's model. The agent model decides which tool to call; the optional Stagehand model powers AI methods such as `act`, `extract`, or `observe` when code passed to `run` uses them.

## How agents use the tools

For deterministic navigation or multi-step work, call `run` with JavaScript:

```json
{
  "code": "await page.goto('https://example.com'); return await page.title();"
}
```

For a simple interaction, take a snapshot and pass its bracketed ID back to `run`:

```json
{
  "actions": [{ "op": "click", "id": "1-42" }]
}
```

`run` accepts exactly one of `code` or `actions`. Supported snapshot actions are `click`, `hover`, `fill`, `type`, `press`, and `select`.

## Security boundary

`run` executes model-authored JavaScript inside the Stagehand browser extension's service worker, not inside the agent host process. That code can control the browser and access data available to the browser, so treat it as privileged browser automation.

Browserbase is the recommended isolation boundary for untrusted tasks because the browser is disposable and separate from the host machine. The MCP examples forward only `STAGEHAND_*` and `BROWSERBASE_*` configuration to the child process; agent-model credentials stay in the framework process.

Disabling Chromium's sandbox weakens local isolation. Use `STAGEHAND_CHROMIUM_SANDBOX=false` only when the surrounding container is already the security boundary.

## Develop and verify

Each framework README includes its exact test and smoke-test commands. For the shared TypeScript implementation, run:

```bash
corepack pnpm@11.10.0 exec turbo run typecheck test:unit \
  --filter @browserbasehq/stagehand-integrations
```
