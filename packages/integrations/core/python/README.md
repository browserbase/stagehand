# stagehand-middleware (Python)

The facade's `run`, `snapshot` and `screenshot` tools for Python, over an existing
`stagehand.Stagehand`. It is a thin host for the facade bundle that
`@browserbasehq/stagehand-integrations` builds (`dist/facade-bundle.json`): the
JavaScript sent to `experimental_batch` and the model-facing contract (tool names,
descriptions, input schemas, error messages and result caps) come from that
bundle, so agents see the same tools as with the TypeScript facade.

```python
from stagehand import Stagehand
from stagehand_middleware.facade import StagehandFacadeTools, facade_instructions, facade_tools

stagehand = await Stagehand.create(...)
tools = StagehandFacadeTools(stagehand, artifact_root="artifacts")

await tools.run(code="await page.goto('https://example.com'); return await page.title();")
tree = await tools.snapshot()
await tools.run(actions=[{"op": "click", "id": "0-7"}])
image = await tools.screenshot(type="jpeg", quality=40)

facade_tools()  # tools/list entries to register with an agent framework
facade_instructions()  # the agent instructions for the system prompt
```

- `run` code runs inside an async function with Playwright-shaped `page`,
  `context` and `browser`. An error it throws is raised as
  `StagehandFacadeExecutionError` (with the JavaScript `name` and `stack`).
  `StagehandFacadeInputError` covers bad input and contract errors (stale
  snapshot IDs, malformed run results, artifact paths and caps, a closed facade).
  Other failures keep their own types: an error from the batch or RPC call
  itself (for example `stagehand.rpc_client.RPCError`) propagates unchanged, a snapshot or
  screenshot past its capture deadline raises `TimeoutError`, and a failed close
  raises `StagehandFacadeCleanupError` (or an `ExceptionGroup` with the run's own
  error). Code that does not parse as an async function body raises
  `SyntaxError` before anything is sent.
- Screenshots saved with a `path` are written under `artifact_root` (default: the
  current directory). A path must stay within it and must not pass through a
  symlink.
- `browser.close()` in run code closes the Stagehand and its browser once the
  call finishes (pass `on_close_requested` to own that cleanup); later calls fail.
- `quiet_wait=True` (experimental, off by default) makes a `page.waitForTimeout(ms)`
  longer than 400 ms in run code return once the page is quiet (DOM loaded, no
  mutation in the main document for 400 ms; shadow roots are not observed),
  never later than `ms`. Shorter waits sleep in full.

This host has no keeper tab and does not latch session loss; the TypeScript
`StagehandFacadeTools` does both.

## Development

`src/stagehand_middleware/facade/_bundle.json` is a copy of the built bundle.
After changing the TypeScript facade, rebuild the integrations package and run
`pnpm run sync:python` in `packages/integrations/core`;
`tests/facade-python-bundle.test.ts` and
`node scripts/sync-python-facade-bundle.mjs --check` (which CI runs in the
Python job) fail while the copy is stale. The package also checks the copy's
`sha256` when it loads it.

```bash
uv run ruff format --check
uv run ruff check
uv run ty check
uv run pytest
```

`tests/test_conformance.py` runs the cases in `../conformance` against this host.
`tests/test_browser.py` drives a local Chrome end to end; it is skipped unless
`STAGEHAND_INTEGRATIONS_BROWSER_TESTS=1` (set `CHROME_PATH` if the Stagehand SDK
does not find Chrome).
