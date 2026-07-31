# Stagehand V4 code-mode MCP spike

This private workspace package is a trusted-code prototype for one MCP tool:
`code_execute`. Generated JavaScript runs against a Stagehand V4 browser that is
always hosted on Browserbase.

## Lifecycle

- Starting the MCP server and listing tools do not create a browser.
- The first `action: "run"` lazily creates a Stagehand instance and Browserbase
  session.
- The response returns an opaque `code_session_id`.
- Later calls that pass the same ID reuse the browser even if the MCP transport
  disconnects and reconnects.
- `action: "close"` closes one logical code session. Server shutdown closes all
  remaining sessions.

`page`, `context`, `stagehand`, `z`, and `console` are available inside each
code cell.

## Run locally

Build Stagehand first so its extension assets exist, then start the MCP:

```bash
pnpm build
BROWSERBASE_API_KEY="<key>" pnpm --filter @browserbasehq/stagehand-codemode build
BROWSERBASE_API_KEY="<key>" node packages/codemode/dist/cli.mjs
```

The Streamable HTTP endpoint defaults to
`http://localhost:8932/mcp`. Use `--stdio` for a local stdio transport.
Binding to a non-loopback host is rejected unless
`CODEMODE_MCP_BEARER_TOKEN` is set. Unauthenticated loopback HTTP accepts only
loopback `Host` and `Origin` values to block browser-based DNS rebinding.
Non-loopback HTTP is plaintext and must sit behind trusted TLS termination.

Optional environment variables:

- `CODEMODE_MCP_BEARER_TOKEN`
- `CODEMODE_DEFAULT_TIMEOUT_MS`
- `STAGEHAND_MODEL_NAME`
- `STAGEHAND_MODEL_API_KEY`
- `STAGEHAND_MODEL_BASE_URL`

## Tool shape

```json
{
  "action": "run",
  "code": "await page.goto(\"https://example.com\"); return await page.title();"
}
```

To reuse the same browser:

```json
{
  "action": "run",
  "code_session_id": "<opaque ID from the first result>",
  "code": "return { url: await page.url(), title: await page.title() };"
}
```

The tool returns the same JSON envelope as text and MCP
`structuredContent` for compatibility across agent harnesses.

A cell timeout is not safe to replay automatically: the error sets
`may_have_side_effects: true` and `retryable: false`. The child runtime closes
the browser on a best-effort basis and then exits so timed-out JavaScript cannot
overlap a later cell.

## Security status

This is not a multi-tenant sandbox. Each logical code session gets
separate-process lifecycle containment, not a security boundary. Evaluated
JavaScript can access Node globals, the filesystem, network, inherited
credentials, and the child process environment. Do not expose this prototype
through an unauthenticated public tunnel.

A hosted version needs a real sandbox/container boundary, scoped credentials,
authentication and authorization, quotas, idle expiry, output limits, and
independent Browserbase lease cleanup.
