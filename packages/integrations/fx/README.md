# fx + Stagehand facade over MCP/stdio

[fx](https://fx.sh) consumes the Stagehand facade as a standard MCP server — no integration
code, just an entry in fx's user-global MCP config. This directory ships the config template,
a project config that sizes fx's limits for browser work, and a skill carrying the facade
usage guidance.

<!-- Verified against fx v0.0.3; fx is experimental and its config surface may change. -->

## Setup

Use Node.js 24 or newer. From the repository root, build the integrations package first:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
```

Install fx (pin the version — fx is experimental) and authenticate with Vercel AI Gateway:

```bash
curl -fsSL https://fx.sh/setup.sh | bash -s -- v0.0.3
fx login   # or: export AI_GATEWAY_API_KEY=...
```

Export the browser credentials (Browserbase is the default and recommended backend):

```bash
export BROWSERBASE_API_KEY=bb_live_...
```

## Configure

fx loads MCP servers only from the user-global `~/.fx/mcp.json`; repository-local MCP config
is deliberately never loaded. Merge `mcp.json` from this directory into `~/.fx/mcp.json`,
filling in the absolute path to your checkout, then run `/mcp reload` in an open session (or
just start a new one).

Leave the `environment` block out, as the template does: fx passes the full shell environment
to the server when no block is set, so the exports above are the only configuration. Setting
`environment` replaces the child environment wholesale — even `PATH` and `HOME` disappear —
so if you must pin variables there, restate `PATH` explicitly.

## Run

Run fx from this directory — this is required, not optional: the `skills/stagehand-facade`
skill teaches the model the exact `mcp_stagehand_*` tool names (fx's tool search cannot find
them), and without it runs stall in discovery and fall back to shell exploration. Running here
also picks up `.fx.json` (which raises `max_tool_result_bytes` —
page snapshots exceed fx's 64 KB default — and `max_agent_steps`, since fx's tool discovery
adds a `mcp_search_tools`/`mcp_select_tool` round trip before the browser tools are callable)
and the `skills/stagehand-facade` skill:

```bash
cd packages/integrations/fx
fx ask --json "Use the stagehand browser tools: open https://example.com, snapshot it, and report the heading citing the snapshot ID."
```

The three tools surface as `mcp_stagehand_run`, `mcp_stagehand_snapshot`, and
`mcp_stagehand_screenshot`. fx v0.0.3's `mcp_search_tools` returns no results for this server,
so the shipped skill instructs the model to select the tools by those exact names instead —
without the skill, runs stall in discovery. Headless runs cannot answer permission prompts; either pre-allow
the tools in `~/.fx/settings.json`:

```json
{
  "permission": {
    "mcp_stagehand_run": "allow",
    "mcp_stagehand_snapshot": "allow",
    "mcp_stagehand_screenshot": "allow"
  }
}
```

or pass `--auto`, accepting that fx adjudicates each gated call with an extra model request.
For browser-only workflows, also deny fx's shell tool — if the model cannot find the browser
tools (for example when the skill is not loaded), it falls back to exploring the machine with
`run_command`, which can dump your environment (including credentials) into the model
transcript:

```json
{
  "permission": {
    "mcp_stagehand_run": "allow",
    "mcp_stagehand_snapshot": "allow",
    "mcp_stagehand_screenshot": "allow",
    "run_command": "deny"
  }
}
```

<Note>
fx starts MCP servers with a fixed 10-second timeout and discards their stderr. The facade
connects immediately and launches the browser lazily on the first tool call, so startup fits
the budget — but if the server misbehaves, debug it standalone (spawn the bin directly and
speak JSON-RPC over stdio) rather than through fx.
</Note>

## Security model

The `run` tool executes model-authored JavaScript inside the Stagehand browser extension's
service worker — browser-side, never on your machine. Browserbase is the recommended isolation
boundary: the privileged execution environment is a disposable cloud browser. With no
`environment` block, the server inherits your shell environment. The facade reads
`STAGEHAND_*`/`BROWSERBASE_*` variables and can also infer a model-provider key
(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or a Google key) from its environment for optional
Stagehand model configuration. To keep provider keys away from the facade entirely, use an
`environment` allowlist instead of inheritance — restating `PATH` and `HOME`, which fx drops
when any block is set:

```json
"environment": {
  "PATH": "/usr/local/bin:/usr/bin:/bin",
  "HOME": "/Users/you",
  "STAGEHAND_BROWSER": "browserbase",
  "BROWSERBASE_API_KEY": "bb_live_..."
}
```
