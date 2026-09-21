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

| Setting                                                           | Default and behavior                                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STAGEHAND_BROWSER`                                               | `browserbase` when `BROWSERBASE_API_KEY` is set, otherwise `local`; accepts these two values only. Local Chrome is headed.                                         |
| `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`                   | Existing Browserbase credentials and optional project ID; the API key is required for Browserbase.                                                                 |
| `STAGEHAND_BROWSERBASE_SESSION_TIMEOUT_SECONDS`                   | `3600`; integer seconds from `1` through `21600`.                                                                                                                  |
| `STAGEHAND_BROWSERBASE_PROXIES`, `STAGEHAND_BROWSERBASE_VERIFIED` | Unset leaves the corresponding Browserbase API option unspecified. Accepts `1/true/yes/on` and `0/false/no/off`. The eval runner explicitly defaults both to true. |
| `STAGEHAND_BROWSERBASE_EXTENSION_ID`                              | Unset uploads a packaged extension for this session; set to reuse the host's uploaded extension. The host owns the shared upload's cleanup.                        |
| `STAGEHAND_MODEL_NAME`, `STAGEHAND_MODEL_API_KEY`                 | Optional Stagehand model configuration. A model API key requires an explicit model name. Plain facade navigation and inspection do not invoke a model.             |

`--surface=playwright` is the default stdio description. `--surface=legacy` selects
the earlier description with the same runtime. `EXPLICIT_SNAPSHOT_ACTIONS=1`
changes Playwright-surface instructions to prefer snapshot IDs for simple actions;
it does not introduce another implementation or change the legacy description.
The runner-only `session_info` call reports browser identity and is absent from
the model-facing tool list.

A failed CDP attach releases a Browserbase session created by that launch even
with `keepAlive: true`. Failed attachment to an existing session does not release
it. There is still a shutdown limitation: the stdio host waits at most five seconds
for pending initialization before proceeding to bounded cleanup. If creation or
attachment has not returned a handle when the process exits, the host cannot
explicitly release that session. A cancellable launch/early lease API is a separate
follow-up; the configured remote session expiry remains the fallback.

## Deadlines and disconnect diagnostics

Facade `run` has a 60-second executor deadline and a 75-second client deadline.
The SDK's `experimentalBatch` option `clientTimeoutMs` controls the entire round
trip: by default it is the executor `timeout` plus 15000 ms, capped at 2147483647 ms.
An explicit value must be an integer from `1` through `2147483647`. A client
deadline raises `StagehandBatchTimeoutError`; it does not cancel or replay the
callback. Executor-reported timeouts are ordinary tool errors.

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
