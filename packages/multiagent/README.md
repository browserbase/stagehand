# `@browserbasehq/multiagent`

`@browserbasehq/multiagent` is a thin driver for combining three moving parts behind one CLI or library entrypoint:

- a shared browser session
- one or more browser-control toolsets
- one or more agent harness loops

The package is structured so browser state, MCP/tool state, and conversation state stay isolated instead of collapsing into one large orchestrator object.

## Architecture

### Codebase map

The package is split by actor/service boundary:

- `lib/runtime/driver.ts`
  - top-level orchestration for one `MultiAgentDriver.run()`
- `lib/browser/*`
  - shared browser session abstraction
- `lib/mcp/*`
  - toolset/MCP abstraction and adapter registry
- `lib/agents/*`
  - agent session abstraction and harness registry
- `lib/cli.ts`
  - CLI entrypoint for `multiagent run` and internal stdio MCP server commands
- `lib/utils/*`
  - process launching, runtime path resolution, and error helpers
- `lib/types.ts`
  - shared public and internal option/result types

### Service boundaries

The package intentionally keeps state in a few small actors instead of one global mutable runtime:

- `MultiAgentDriver`
  - owns one run request
  - creates and wires the other actors
  - owns the top-level cleanup order
- `BrowserSession`
  - owns browser process/connection state
  - knows whether the browser was launched locally or attached externally
- `MCPServer`
  - owns one toolset adapter and, when started in-process, one MCP client transport
  - can either provide launch config to an external harness or act as an in-process MCP client
- `AgentSession`
  - owns one harness instance
  - owns one message history
  - owns the list of attached tool servers for that harness
- harness implementation
  - owns harness-specific resume/session state
  - converts `AgentRunInput` into one external CLI call or one in-process agent execution

### State ownership

The core design goal is that each actor owns one category of state:

- Browser state lives in `BrowserSession`
  - local browser process handle or attached connection
  - derived `cdpUrl` and `browserUrl`
- Tool server state lives in `MCPServer`
  - adapter selection
  - stdio client transport when `start()` is used
- Conversation state lives in `AgentSession`
  - ordered `messages[]`
  - attached `MCPServer[]`
- Harness-native session state lives inside each harness
  - for example Claude session id, Codex thread id, Gemini session id, OpenCode session id

That separation is why the driver can share one browser across multiple harnesses without collapsing their conversation history or tool wiring together.

### Run lifecycle

One `multiagent run` call currently follows this lifecycle:

1. `MultiAgentDriver` builds a `BrowserSession` from `options.browser`
2. `BrowserSession.start()` launches local Chrome or attaches to an existing CDP target
3. `MultiAgentDriver` creates one `MCPServer` instance per requested toolset
4. `MultiAgentDriver` creates one `AgentSession` per requested harness
5. Each `AgentSession` attaches all selected `MCPServer` instances
6. Each `AgentSession.start()` calls harness-specific startup
   - no-op for most CLI harnesses
   - Stagehand allocates its in-process V3 runtime here
7. Each `AgentSession.addUserMessage(task)`:
   - records the user message locally
   - asks each attached `MCPServer` for a stdio launch config
   - calls `harness.runTurn(...)`
   - records the assistant message locally
8. `MultiAgentDriver` collects all per-agent results
   - individual harness failures are captured per agent instead of aborting the whole run
9. Cleanup runs in `finally`
   - stop all `AgentSession`s
   - stop all started `MCPServer`s
   - stop the shared `BrowserSession`

### Turn lifecycle

Inside one `AgentSession.addUserMessage(...)` call:

1. A user message object is appended to the session history
2. Attached MCP servers are converted into named stdio launch configs
3. The harness receives:
   - `prompt`
   - `mcpServers`
   - `cwd`
4. The harness executes one turn
   - external CLI harnesses spawn a child process
   - Stagehand runs in-process
   - browser-use launches an inline Python agent via `uvx`
5. The returned content/raw/usage is wrapped into an assistant message
6. The assistant message is appended to the session history
7. The turn result is returned to the driver

### MCP lifecycle

`MCPServer` supports two distinct lifecycles:

- launch-config only
  - used when an external harness such as Claude Code or OpenCode consumes the tool server itself
  - `getLaunchConfig()` is enough
- in-process MCP client
  - used when this package wants to introspect or call tools directly
  - `start()` creates a stdio transport and MCP client
  - `listTools()` and `callTool()` operate through that client
  - `stop()` closes the client and transport

This split is important because most harnesses do not want the driver to proxy tool calls. They want raw stdio server definitions and talk to the MCP servers themselves.

### Browser lifecycle

`BrowserSession` has two modes with different shutdown semantics:

- `local`
  - launches a browser process through Puppeteer
  - shutdown closes the browser process
- `cdp`
  - attaches to an existing browser target
  - shutdown disconnects only and leaves the external browser running

Both modes normalize metadata into the same shape so adapters and harnesses can depend on:

- `getCdpUrl()`
- `getBrowserUrl()`
- `getMetadata()`

### Why this split exists

The main tradeoff in this package is isolation over convenience:

- browser ownership is centralized so all harnesses can share one target
- harness state is isolated so resume ids, prompts, and histories do not bleed together
- tool adapters are isolated so each server can define its own launch/config semantics
- the driver remains small because it mostly wires actors together instead of containing business logic

That makes it easier to add new harnesses and toolsets without rewriting the orchestration layer.

## Support Matrix

### Agent harnesses

| Harness | Status | Notes |
| --- | --- | --- |
| `claude-code` | implemented, manually verified | Verified with Playwright MCP + local browser |
| `codex` | implemented, partially verified | Session wiring works, but MCP tool calls were cancelled in this environment |
| `gemini-cli` | implemented | Uses isolated `GEMINI_CLI_HOME` + `.gemini/settings.json`; live run here stops on missing Gemini auth |
| `opencode` | implemented, manually verified | Verified with Playwright MCP + local browser via the native OpenCode binary |
| `browser-use` | implemented, manually verified | Verified with shared local browser via CDP; currently uses browser-use native tools instead of external MCP bridging |
| `stagehand` | implemented | In-process Stagehand V3 harness; supports `dom`, `hybrid`, and `cua` modes |

### MCP servers / toolsets

| Toolset | Status | Notes |
| --- | --- | --- |
| `playwright` | implemented, manually verified | Supports `--cdp-endpoint` and shared browser ownership |
| `chrome-devtools` | implemented | Adapter implemented; not manually re-verified in this pass |
| `agent-browser` | implemented | MCP/tool adapter only |
| `browser-use` | implemented | Uses `uvx browser-use[cli] --mcp` by default |
| `stagehand-agent` | implemented, smoke-tested | Internal stdio MCP server enumerates Stagehand agent tools against a shared CDP browser |
| `understudy` | implemented, smoke-tested | Internal stdio MCP server enumerates Understudy page tools against a shared CDP browser |

### Browser modes

| Browser mode | Status | Notes |
| --- | --- | --- |
| `local` | implemented, manually verified | Launches local Chrome/Chromium through Puppeteer |
| `cdp` | implemented | Attaches to an existing CDP target |

## Harness reference

### `claude-code`

- Binary: `claude`
- Invocation shape: `claude -p --output-format json ...`
- Session behavior: resumes with `--resume <session_id>` when a prior turn exists
- Tool integration: writes a temporary MCP config JSON and passes `--mcp-config ... --strict-mcp-config`
- Model support: forwarded through `--model`
- Permission mode: forwarded through `--permission-mode`, defaulting to `bypassPermissions`
- Auth/setup: requires a working Claude Code install and auth on the machine
- Best fit: external agent loop that should consume MCP servers directly

### `codex`

- Binary: `codex`
- Invocation shape: `codex exec --json ...`
- Session behavior: resumes with `codex exec resume --json <thread_id>`
- Tool integration: injects MCP server definitions through `-c mcp_servers.<name>.*=...`
- Model support: forwarded through `--model`
- Permission/sandbox behavior: forces `approval_policy`, `sandbox_mode=workspace-write`, and network access on
- Auth/setup: requires a working Codex CLI install and auth on the machine
- Known limitation: in this environment, Codex session wiring works but MCP tool calls were cancelled at runtime

### `gemini-cli`

- Binary: `gemini`
- Invocation shape: `gemini --prompt ... --output-format json ...`
- Session behavior: resumes with `--resume <session_id>`
- Tool integration: creates an isolated temporary `GEMINI_CLI_HOME`, writes `.gemini/settings.json`, and injects MCP servers under `mcpServers`
- MCP allow-listing: passes `--allowed-mcp-server-names ...` for the attached servers
- Model support: forwarded through `--model`
- Permission mode: mapped to Gemini approval modes; `never`/`bypassPermissions` become `yolo`
- Auth/setup: requires Gemini auth or `GEMINI_API_KEY`
- Current verification: the harness path is real and verified, but this environment does not have Gemini auth configured

### `opencode`

- Binary: resolves the native OpenCode binary directly, bypassing the broken Homebrew wrapper when necessary
- Invocation shape: `opencode run --format json ...`
- Session behavior: resumes with `--session <session_id>`
- Tool integration: injects an isolated `OPENCODE_CONFIG_CONTENT` JSON payload with local MCP server entries
- Model support: forwarded through `--model`
- Auth/setup: requires a working OpenCode install and auth on the machine
- Current verification: verified end-to-end with Playwright MCP + local browser

### `browser-use`

- Runtime: `uvx --from browser-use[...] python -c ...`
- Execution model: runs a small inline Python program that creates a `browser_use.Agent`
- Browser integration: connects to the shared browser via the session CDP URL
- Model support: provider is inferred from model prefix or available env vars
  - `anthropic/...`
  - `google/...`
  - `browser-use/...`
- Auth/setup: requires `uv` plus provider credentials such as `ANTHROPIC_API_KEY`
- Tool integration: currently uses browser-use native tools only; attached MCP servers are intentionally rejected
- Current verification: verified end-to-end with a shared local browser and Anthropic-backed browser-use

### `stagehand`

- Runtime: in-process via `@browserbasehq/stagehand`
- Browser integration: connects Stagehand V3 to the shared browser CDP URL
- Tool integration: starts temporary MCP stdio clients and passes them as Stagehand integrations for the current turn
- Mode support: `dom`, `hybrid`, `cua`
- Model support: forwarded into `V3` and `agent(...)`
- Auth/setup: depends on whatever model/provider config Stagehand uses in your environment
- Best fit: native Stagehand agent loop over the shared browser

## Toolset reference

### `playwright`

- Adapter binary: `@playwright/mcp`
- Launch shape: runs the package bin with Node
- Browser wiring:
  - shared browser present: passes `--cdp-endpoint <ws_url>`
  - no shared browser: lets Playwright MCP launch its own browser
- Viewport support: passes `--viewport-size <width>x<height>` when configured
- Headless behavior: passes `--headless` only when not attaching to an existing browser
- Best fit: Claude Code, OpenCode, Codex, or Gemini harnesses that should drive the browser through MCP

### `chrome-devtools`

- Adapter binary: `chrome-devtools-mcp`
- Launch shape: runs the package bin with Node
- Browser wiring:
  - shared browser present: passes `--browser-url=<http_url>`
  - no shared browser and headless requested: passes `--headless=true --isolated=true`
- Viewport support: passes `--viewport <width>x<height>`
- Extra behavior: always passes `--no-usage-statistics`
- Best fit: DevTools-oriented browser inspection/control through MCP

### `agent-browser`

- Adapter binary: `agent-browser-mcp`
- Additional runtime dependency: resolves the `agent-browser` CLI and exports it as `AGENT_BROWSER_PATH`
- Browser wiring: delegated to the upstream MCP server/runtime
- Best fit: exposing agent-browser capabilities as tools to another harness
- Note: this exists as a tool adapter, not as a first-class harness

### `browser-use`

- Adapter command: defaults to `uvx browser-use[cli] --mcp`
- Override support: `command` and `args` can replace the default launcher
- Browser wiring: delegated to the upstream browser-use MCP server
- Best fit: exposing browser-use MCP tools to another external harness
- Note: separate from the native `browser-use` harness described above

### `stagehand-agent`

- Adapter command: loops back into `multiagent mcp-server stagehand-agent`
- Runtime choice:
  - built package: uses `dist/cli.js`
  - source tree without build output: falls back to `node --import tsx lib/cli.ts`
- Browser wiring: passes `--cdp-url <ws_url>` from the shared browser session
- Best fit: exposing Stagehand agent tools over stdio MCP to another harness

### `understudy`

- Adapter command: loops back into `multiagent mcp-server understudy`
- Runtime choice:
  - built package: uses `dist/cli.js`
  - source tree without build output: falls back to `node --import tsx lib/cli.ts`
- Browser wiring: passes `--cdp-url <ws_url>` from the shared browser session
- Best fit: exposing Understudy page tools over stdio MCP to another harness

## Browser mode reference

### `local`

- Launches Chrome/Chromium via `puppeteer-core`
- Default channel: `chrome`
- Default headless mode: `true`
- Exposes:
  - a CDP WebSocket URL for harnesses and MCP servers
  - a derived browser HTTP URL for adapters that expect `browserURL`
- Supports:
  - `channel`
  - `executablePath`
  - `userDataDir`
  - `viewport`
  - `args`
  - `ignoreHTTPSErrors`
  - `connectTimeoutMs`

### `cdp`

- Attaches to an existing CDP browser via either:
  - `browserURL` when the configured URL is `http(s)://...`
  - `browserWSEndpoint` when the configured URL is `ws(s)://...`
- Treats the browser as externally owned
- On shutdown: disconnects instead of closing the browser
- Requires: `browser.cdpUrl`

## Known limitations

- `agent-browser` is supported as a tool/runtime adapter, not as an agent harness.
- `browser-use` currently does not bridge external MCP toolsets into the browser-use agent. It uses browser-use native tools only.
- `gemini-cli` requires Gemini auth. In this environment, the harness wiring works, but no `GEMINI_API_KEY` or Gemini auth profile is configured.

## CLI usage

Install the package:

```bash
npm install @browserbasehq/multiagent
```

Run a single verified agent + toolset + browser combination:

```bash
multiagent run \
  --task "Use the Playwright browser tools to open https://example.com and reply with only the page title." \
  --agent opencode \
  --mcp playwright \
  --browser local \
  --headless \
  --json
```

Run multiple harnesses against the same browser/tool combination:

```bash
multiagent run \
  --task "Open https://example.com and summarize what is on the page." \
  --agent claude-code \
  --agent opencode \
  --mcp playwright \
  --browser local \
  --headless
```

Attach to an existing browser instead of launching one:

```bash
multiagent run \
  --task "Inspect the current tab and return its title." \
  --agent claude-code \
  --mcp chrome-devtools \
  --browser cdp \
  --cdp-url ws://127.0.0.1:9222/devtools/browser/...
```

Use the browser-use harness with its native tool stack:

```bash
multiagent run \
  --task "Open https://example.com and reply with only the page title." \
  --agent browser-use \
  --browser local \
  --headless \
  --model anthropic/claude-sonnet-4-20250514 \
  --json
```

Run Gemini with isolated settings:

```bash
multiagent run \
  --task "Inspect the current page and summarize it." \
  --agent gemini-cli \
  --mcp playwright \
  --browser local \
  --headless \
  --json
```

Serve the internal MCP servers directly:

```bash
multiagent mcp-server stagehand-agent --cdp-url ws://127.0.0.1:9222/devtools/browser/...
multiagent mcp-server understudy --cdp-url ws://127.0.0.1:9222/devtools/browser/...
```

## JSON config

Use `--config` when you need per-agent options such as distinct models or Stagehand modes.

```json
{
  "task": "Open example.com and summarize the page.",
  "cwd": "/path/to/project",
  "browser": {
    "type": "local",
    "headless": true,
    "viewport": {
      "width": 1440,
      "height": 900
    }
  },
  "mcpServers": [
    { "type": "playwright" },
    { "type": "understudy" }
  ],
  "agents": [
    { "type": "claude-code" },
    { "type": "opencode" },
    {
      "type": "stagehand",
      "stagehandMode": "hybrid",
      "model": "google/gemini-2.0-flash"
    }
  ]
}
```

Run it:

```bash
multiagent run --config ./multiagent.json --json
```

## Config reference

### `browser`

Supported keys come from `BrowserSessionOptions`:

- `type`: `local` or `cdp`
- `cdpUrl`: required for `type: "cdp"`
- `headless`
- `executablePath`
- `channel`
- `userDataDir`
- `viewport`
- `args`
- `ignoreHTTPSErrors`
- `connectTimeoutMs`

### `mcpServers[]`

Supported keys come from `MCPServerOptions`:

- `type`
  - `playwright`
  - `chrome-devtools`
  - `agent-browser`
  - `browser-use`
  - `stagehand-agent`
  - `understudy`
- `name`
- `enabled`
- `env`
- `args`
- `command`
- `browser`
- `transport`

### `agents[]`

Supported keys come from `AgentHarnessOptions`:

- `type`
  - `claude-code`
  - `codex`
  - `gemini-cli`
  - `opencode`
  - `browser-use`
  - `stagehand`
- `model`
- `cwd`
- `env`
- `args`
- `permissionMode`
- `stagehandMode`

## Library surface

The package currently exports:

- `BrowserSession`
- `MCPServer`
- `AgentSession`
- `MultiAgentDriver`

That is enough to either use the bundled CLI or build a higher-level scheduler that decides which agents, toolsets, and browser sessions to compose for a task.

## Development setup

When you add or change a harness, toolset, browser mode, config field, auth prerequisite, or verification status, update this README in the same change.

### Prerequisites

- Node `^20.19.0 || >=22.12.0`
- `pnpm`
- local Chrome/Chromium if you want `browser.type = "local"`
- `uv` if you want the `browser-use` harness or `browser-use` MCP server
- external agent CLIs on your `PATH` for the harnesses you plan to use
  - `claude`
  - `codex`
  - `gemini`
  - `opencode`

### Install

From the repo root:

```bash
pnpm install --ignore-scripts
```

### Build and test

```bash
pnpm --filter @browserbasehq/multiagent run typecheck
pnpm --filter @browserbasehq/multiagent run test
pnpm --filter @browserbasehq/multiagent run build
```

### Useful smoke tests

OpenCode + Playwright + local browser:

```bash
node packages/multiagent/dist/cli.js run \
  --task "Use the Playwright browser tools to open https://example.com and reply with only the page title." \
  --agent opencode \
  --mcp playwright \
  --browser local \
  --headless \
  --json
```

browser-use + local browser:

```bash
node packages/multiagent/dist/cli.js run \
  --task "Open https://example.com and reply with only the page title." \
  --agent browser-use \
  --browser local \
  --headless \
  --model anthropic/claude-sonnet-4-20250514 \
  --json
```

Gemini auth-path verification:

```bash
node packages/multiagent/dist/cli.js run \
  --task "Open https://example.com and reply with only the page title." \
  --agent gemini-cli \
  --browser local \
  --headless \
  --json
```

### Credentials

Each harness uses its native auth flow:

- `claude-code`: Anthropic / Claude Code auth
- `codex`: Codex auth
- `gemini-cli`: Gemini auth or `GEMINI_API_KEY`
- `opencode`: OpenCode auth
- `browser-use`: whichever provider matches the selected model
  - for example `ANTHROPIC_API_KEY` with `anthropic/...`

## Verification

Manual verification completed for:

- `claude-code` harness
- `opencode` harness with Playwright MCP + local browser
- `browser-use` harness with shared local browser via CDP
- `gemini-cli` harness error path through the driver
- `playwright` MCP adapter
- local browser launch owned by `BrowserSession`
- internal `stagehand-agent` MCP server boot + tool enumeration
- internal `understudy` MCP server boot + tool enumeration

Successful end-to-end runs returned `Example Domain` from `https://example.com` through the built `multiagent` CLI for both:

- OpenCode + Playwright + local browser
- browser-use + local browser
