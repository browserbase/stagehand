# Stagehand Ruby SDK — spike (AP-2857)

A **walking-skeleton** Ruby client for Stagehand v4, built to scope the effort of a
production Ruby SDK (see [`ESTIMATE.md`](./ESTIMATE.md)). It proves every risky layer
end to end but deliberately implements only a sliver of the API surface.

## What works

- **Generated wire models** — `scripts/generate.rb` (stdlib-only) compiles all 234
  protocol definitions from `packages/protocol/stagehand.v4.json` into plain Ruby
  classes with exclude-unset `to_wire` / forward-compatible `from_wire`, plus
  `METHODS` / `NOTIFICATIONS` registries. Wired into `just generate` and
  `just check` (`--check` drift mode).
- **CDP transport** (`cdp_client.rb` + `web_socket.rb`) — `/json/version` resolution,
  WebSocket (ws/wss via `websocket-driver`), extension install/discovery, service-worker
  attach (with wake nudge), `__stagehandSendToHost` binding, runtime marker + semver
  negotiation, `Runtime.evaluate` double-JSON envelope delivery.
- **JSON-RPC client** (`rpc_client.rb`) — strict envelopes, per-method timeout table,
  notification buffering (`stagehand.log` → stderr), inbound requests answered with
  `-32601`, deterministic shutdown.
- **Local Chrome** (`browser.rb`) — hand-rolled launcher (no Playwright): Chrome
  discovery, temp profile, the Stagehand flag set, `Extensions.loadUnpacked`.
- **Browserbase** (`browserbase_client.rb`, `browserbase_session.rb`,
  `extension_assets.rb`) — deterministic extension zip (byte-identical to the Python
  SDK's archive), upload, session create/release with SDK-identity `userMetadata`.
- **Client surface** — `Stagehand.create` / `close`, `act`, `extract` (plain JSON
  Schema hashes), `observe`, `metrics`, `context.pages/new_page/active_page`,
  `page.goto/url/title`.

## Usage

```ruby
require "stagehand"

browser = Stagehand::LocalBrowser.launch(headless: true)
# or: Stagehand::Browserbase.launch(api_key: ENV["BROWSERBASE_API_KEY"])

sh = Stagehand.create(browser: browser, model: "openai/gpt-5-mini",
                      model_api_key: ENV["OPENAI_API_KEY"])
page = browser.context.active_page
page.goto("https://docs.stagehand.dev/")
sh.act("click the quickstart link")
result = sh.extract("extract the page title",
                    schema: { "type" => "object",
                              "properties" => { "title" => { "type" => "string" } },
                              "required" => ["title"], "additionalProperties" => false })
puts result.data
sh.close
browser.close
```

Demo: `bundle exec ruby examples/demo.rb [--browserbase]` (see the header of
`examples/demo.rb` for model/env resolution). Note: with a local browser an LLM
provider key is required; the Browserbase Model Gateway is only available on
Browserbase sessions.

## Development

Requires Ruby >= 3.2 and the built extension (`pnpm --filter ./packages/extension build`).

```
bundle install
bundle exec rake test         # unit tests (no browser needed)
ruby scripts/generate.rb      # regenerate models (also part of `just generate`)
```

## Spike shortcuts (not production behavior)

- Only ~15 of the 77 protocol methods are wrapped; the rest need mechanical
  wrappers on the existing pattern.
- Unions decode laxly (first structurally-matching variant); no strict scalar
  validation (the extension re-validates everything server-side).
- `llm.generate` (client-side LLM) and `stagehand.callback_batch` are unsupported.
- No OpenTelemetry trace propagation (`traceparent` is simply omitted).
- `Browserbase.launch(browser_settings:)` is a camelCase passthrough hash.
- Windows Chrome launching is not implemented.
- Notification listeners run on the RPC reader thread and must not issue RPC calls.
- Not wired into ast-grep parity tests, docs tabs, CI, or release tooling
  (each is priced in `ESTIMATE.md`).
