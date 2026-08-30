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
  notification buffering (`stagehand.log` → stderr), an inbound dispatcher thread
  serving server→client requests (`on_request`, used for `llm.generate`) and
  notification listeners, deterministic shutdown.
- **Local Chrome** (`browser.rb`) — hand-rolled launcher (no Playwright): Chrome
  discovery, temp profile, the Stagehand flag set, `Extensions.loadUnpacked`.
- **Browserbase** (`browserbase_client.rb`, `browserbase_session.rb`,
  `extension_assets.rb`) — deterministic extension zip (byte-identical to the Python
  SDK's archive), upload, session create/release with SDK-identity `userMetadata`,
  and `Stagehand::Browserbase.session_logs(api_key:, session_id:)` to fetch a
  session's raw CDP event log for post-run verification.
- **Client surface** — `Stagehand.create` / `close`, `act`, `extract` (plain JSON
  Schema hashes), `observe`, `metrics`, `experimental_batch` (trusted
  JavaScript against the worker-local object model via the callback-batch
  CDP delivery path), and client-side LLMs: pass a callable as `model:` and
  every model call comes back as an inbound `llm.generate` request with
  decoded params (see `examples/custom_llm.rb`). `create` also takes
  `telemetry:` (OTLP traces, endpoint validated) and `cache:`
  (true/false/`{threshold:}`), mirroring the sibling SDKs.
- **Validation** (`validation.rb`) — port of the Python SDK's `_validation.py`:
  create-config scalar constraints, screenshot cross-field rules
  (`full_page`+`clip`, `quality` only for jpeg), OTLP endpoint and cache
  option checks. Closed protocol unions decode strictly (a value matching no
  variant raises `WireError`); unions with scalar/null variants stay open.
- **RBS signatures** (`sig/stagehand.rbs`) — the public API surface, validated
  by `bundle exec rake rbs` (part of the default rake task).
- **Page** — navigation (`goto/reload/go_back/go_forward`, returning a
  `Stagehand::Response` with `status/headers/body/security_details/finished`),
  `url/title/close`, input (`click/hover/scroll/drag_and_drop/type/key_press`),
  `evaluate`, `screenshot`, `snapshot`, `add_init_script`,
  `set_extra_http_headers`, `set_viewport_size`, the `wait_for_*` family,
  console events via `page.on("console") { |event| ... }` (+ unsubscribe),
  and WebMCP (`tools` → invoke/result/cancel).
- **Locator** — `page.locator(selector)` → all 17 locator methods
  (`click/fill/type/hover/scroll_to/count/text_content/inner_text/inner_html/
input_value/visible?/checked?/centroid/highlight/send_click_event/
select_option/set_input_files` + `first`/`nth`; file uploads take paths or
  `Stagehand::FilePayload`, 50 MiB/file).
- **Context** — `pages/new_page/active_page/set_active_page/close`, cookies
  (`cookies/add_cookies/clear_cookies` with String/Regexp filters), clipboard
  (`read_text/write_text/clear/paste/copy/cut`), `add_init_script`,
  `set_extra_http_headers`, and `get/set_domain_policy`.

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

### Examples

The canonical example set (`packages/sdk-{ts,python,go}/examples`), each
self-contained and runnable as `bundle exec ruby examples/<name>.rb
[--browserbase]`. The `example-parity` ast-grep lane keeps their inventory and
SDK operations aligned with the sibling SDKs.

| Example                              | Notes                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `act.rb`, `observe.rb`, `extract.rb` | example.com; local runs need OPENAI_API_KEY, `--browserbase` uses the Gateway |
| `model_gateway.rb`                   | Browserbase-only; no model configured (Gateway picks one)                     |
| `caching.rb`                         | Browserbase-only; `cache: true` + `metadata.cache` round-trip                 |
| `custom_logging.rb`                  | `on_log:` callback appending JSONL to `stagehand.jsonl`                       |
| `file_upload.rb`                     | locator.set_input_files + evaluate; no LLM needed                             |
| `batch.rb`                           | callback batch, no LLM needed                                                 |
| `page_events.rb`                     | page.on console events + AI extract                                           |
| `custom_llm.rb`                      | bring-your-own-LLM via `llm.generate` (OPENAI_API_KEY or AI_GATEWAY_API_KEY)  |
| `webmcp.rb`                          | page-registered tools via `page.tools` → invoke → result; no LLM needed       |

`examples/extras/` holds Ruby-only walkthroughs outside the canonical set
(`demo.rb`, `page_interactions.rb`, `context_and_response.rb`,
`hybrid_news.rb`, `search_flow.rb`, `arctic_observe.rb`) plus their shared
`example_helpers.rb`.

### Evals

`evals/` holds Ruby ports of the bench-tier eval tasks (act/extract/observe)
with their own runner — see [`evals/README.md`](./evals/README.md).

## Development

Requires Ruby >= 3.2 and the built extension (`pnpm --filter ./packages/extension build`).

```
bundle install
bundle exec rake              # unit tests + RBS validation (no browser needed)
SOAK=20 bundle exec rake test # scale up the thread-safety soak suite
ruby scripts/generate.rb      # regenerate models (also part of `just generate`)
```

## Spike shortcuts (not production behavior)

- All 77 protocol methods are wrapped — the complete method surface,
  including inbound `llm.generate` (client-side LLMs).
- No strict scalar validation inside wire models (field types are not
  checked; the extension re-validates everything server-side). Union and
  structural mismatches do raise.
- No OpenTelemetry trace propagation (`traceparent` is simply omitted).
- `Browserbase.launch(browser_settings:)` is a camelCase passthrough hash.
- Inbound work (request handlers, notification listeners including `page.on`
  blocks) runs on one dispatcher thread: handlers may issue RPC calls, but a
  slow handler delays later inbound work (Python runs these concurrently).
- Wired into the ast-grep parity lanes (`rules/ast-grep/{rpc,cdp,example,sdk}-parity`);
  the `sdk-field-pipeline` and `sdk-client-schema-parity` Ruby lanes land with
  the docs tabs. Docs, CI, and release tooling are still pending (priced in
  `ESTIMATE.md`).
