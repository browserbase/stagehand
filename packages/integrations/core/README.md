# Shared Stagehand facade

`@browserbasehq/stagehand-integrations` defines the shared `run`, `snapshot`, and
`screenshot` contract. Harnesses mount these tools through the `stagehand-facade`
stdio server or use `StagehandFacadeTools` with an existing Stagehand instance.
Tool schemas, instructions, and browser behavior live in this package.

## Browser ownership and configuration

The stdio host owns one browser for its lifetime. It closes Stagehand and then the
browser explicitly. Browserbase sessions use `keepAlive: true` so transport loss
does not silently replace the session. A hidden `about:blank` keeper is excluded
from the facade's pages and page events; closing the last visible tab permits a
new visible page in the same browser. In-process callers can pass
`{ keeperPage: false }` to `StagehandFacadeTools` and remain responsible for cleanup.

| Setting                                                           | Default and behavior                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAGEHAND_BROWSER`                                               | `browserbase` when `BROWSERBASE_API_KEY` is set, otherwise `local`; accepts these two values only. Local Chrome is headed.                                                                                                                                            |
| `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`                   | Existing Browserbase credentials and optional project ID; the API key is required for Browserbase.                                                                                                                                                                    |
| `STAGEHAND_BROWSERBASE_SESSION_TIMEOUT_SECONDS`                   | `3600`; integer seconds from `1` through `21600`.                                                                                                                                                                                                                     |
| `STAGEHAND_BROWSERBASE_PROXIES`, `STAGEHAND_BROWSERBASE_VERIFIED` | Unset leaves the corresponding Browserbase API option unspecified. Accepts `1/true/yes/on` and `0/false/no/off`. The eval runner explicitly defaults both to true.                                                                                                    |
| `STAGEHAND_BROWSERBASE_EXTENSION_ID`                              | Unset uploads a packaged extension for this session; set to reuse the host's uploaded extension. The host owns the shared upload's cleanup.                                                                                                                           |
| `STAGEHAND_MODEL_NAME`, `STAGEHAND_MODEL_API_KEY`                 | Optional Stagehand model configuration. A model API key requires an explicit model name. Plain facade navigation and inspection do not invoke a model.                                                                                                                |
| `STAGEHAND_FACADE_QUIET_WAIT`                                     | Off unless `1/true/yes/on`. Experimental: a `page.waitForTimeout(ms)` longer than 400 ms returns once the page is quiet (DOM loaded, no mutation in the main document for 400 ms; shadow roots are not observed), never later than `ms`. Shorter waits sleep in full. |

`--surface=playwright` is the default stdio description. `--surface=legacy` selects
the earlier description with the same runtime. `EXPLICIT_SNAPSHOT_ACTIONS=1`
changes Playwright-surface instructions to prefer snapshot IDs for simple actions;
it does not introduce another implementation or change the legacy description.
The runner-only `session_info` call reports browser identity and is absent from
the model-facing tool list.

The build also writes `dist/facade-bundle.json` for facade hosts in other
languages: the exact callback sources the facade sends to `experimentalBatch`,
the tools/list and agent instructions of each tool set, and the error and
screenshot messages hosts return verbatim. The TypeScript facade builds what
it sends from the same constants. A host sends the sources unchanged and
supplies only the batch input:

| Callback                                      | Input                                                        | Result                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `run` code: `runPrelude + code + runEpilogue` | `{ hiddenPageIds?: string[] }`, pages hidden from agent code | `{ value, executionError?, telemetry, artifacts, closeRequested, batchRuntimeMs }`; errors thrown by `code` are `executionError` |
| `run` actions: `actionRunner`                 | `{ actions, xpathById }`, the latest snapshot's XPath map    | `{ completed }`, or `{ staleId }` before any action runs, which the host reports as `STALE_SNAPSHOT_ID_ERROR`                    |

The run input also carries the options in `contract.runOptions`, only when a
host turns them on: `quietWait: true` (`StagehandFacadeTools`'s `quietWait`,
the Python host's `quiet_wait`). Each run report's `telemetry.waits` gives
`{ count, requestedMs, waitedMs, earlyReturns }` for `page.waitForTimeout`, in
both modes; the stdio server writes it on its `stagehand_playwright_compat`
stderr line.

The host keeps the per-page snapshot map and the missing-snapshot and navigation
checks, rejects run results without the envelope's shape, and enforces the caps
in `contract.limits` (32 artifacts, 25 MB per artifact, 100 MB in total, 10 MB of
returned JSON); `src/facade/bundle.ts` documents the shapes in full. The cases in
`conformance/` pin this behavior for every host. A host must reject
run `code` that does not parse on its own as an async function body, as
`AsyncFunction(params, code)` does in TypeScript, before joining it with the
prelude and epilogue. `sha256` covers the UTF-8 canonical JSON of
`{ sources, contract }`: keys sorted, no whitespace, and `JSON.stringify` string
escaping, so non-ASCII characters are not escaped.

`python/` is the Python host, `stagehand-middleware` (`stagehand_middleware.facade`).
It ships a copy of the bundle; run `pnpm run sync:python` after building to refresh
it, and `tests/facade-python-bundle.test.ts` fails while the copy is stale.

A failed CDP attach releases a Browserbase session created by that launch even
with `keepAlive: true`. Failed attachment to an existing session does not release
it. There is still a shutdown limitation: the stdio host waits at most five seconds
for pending initialization before proceeding to bounded cleanup. If creation or
attachment has not returned a handle when the process exits, the host cannot
explicitly release that session. A cancellable launch/early lease API is a separate
follow-up; the configured remote session expiry remains the fallback.

## Deadlines and disconnect diagnostics

Facade `run` has a 60-second executor deadline and a 75-second client deadline.
The SDK bounds the entire `experimentalBatch` round trip at the executor `timeout`
plus 15000 ms, capped at 2147483647 ms. A client deadline raises
`StagehandBatchTimeoutError`; it does not cancel or replay the callback.
Executor-reported timeouts are ordinary tool errors.

Snapshot and screenshot captures have a 120-second local deadline. The first two
consecutive capture deadlines return tool errors; the third latches terminal loss.
A successful tool resets the counter. A failed snapshot invalidates its previous
IDs, and late completion cannot overwrite a newer snapshot. Terminal loss rejects
queued calls before dispatch. There is no CDP reconnect or action replay.

| Setting                      | Default and behavior                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `STAGEHAND_CDP_HEARTBEAT_MS` | `20000`; integer milliseconds from `1000` through `2147483647`. Invalid values fall back to the default. |
| `STAGEHAND_CDP_LOG`          | Unset disables logging; exactly `1` enables `CDP_DROP` on stderr.                                        |
| `STAGEHAND_CDP_LOG_FILE`     | Optional append-only copy of enabled `CDP_DROP` lines. Setting the path alone does not enable logging.   |

At most one `Browser.getVersion` heartbeat is pending. It has its own deadline of
the smaller of the interval and 10000 ms. Timers are unref'ed and stop on closure;
a missed heartbeat alone does not reconnect or mark the facade lost. Drop logs
contain timing, pending-count, method, code, and sanitized reason metadata, without
connection URLs or protocol payloads. Logging failure does not change the outcome.

The optional stdio `--max-screenshot-base64-bytes=N` flag requires an integer of
at least 1024. When enabled, compressed viewport fallbacks enforce both the byte
budget and a 2000-pixel maximum side; without the flag this transport adjustment
is not enabled.

## Local regression checks

From the repository root, with workspace dependencies and the extension, SDK, and
core builds available:

```sh
pnpm --filter @browserbasehq/stagehand-integrations test:unit
pnpm --filter @browserbasehq/stagehand-integrations test:browser
```

The browser suite uses local Chrome and static loopback fixtures with no remote
sites, credentials, or model requests. It compares label/strict-locator behavior
with native Playwright and checks real same-origin and out-of-process frames
through the SDK and extension. DOM tests and hooks have 20-second limits; the
extension/frame test has a 45-second limit. Chrome must already be installed;
`PLAYWRIGHT_CHROMIUM_CHANNEL` selects the DOM suite's channel (default `chrome`).
The SDK's local browser launcher also supports `CHROME_PATH`.
