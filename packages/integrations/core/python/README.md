# stagehand-integrations (Python)

The facade's `run`, `snapshot` and `screenshot` tools for Python, over an existing
`stagehand.Stagehand`. It is a thin host for the facade bundle that
`@browserbasehq/stagehand-integrations` builds (`dist/facade-bundle.json`): the
JavaScript sent to `experimental_batch` and the model-facing contract (tool names,
descriptions, input schemas, error messages and result caps) come from that
bundle, so agents see the same tools as with the TypeScript facade.

```python
from stagehand import Stagehand
from stagehand_integrations.facade import StagehandFacadeTools, facade_instructions, facade_tools

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
  `StagehandFacadeExecutionError` (with the JavaScript `name` and `stack`);
  ordinary tool errors are `StagehandFacadeInputError`. Code that does not parse
  as an async function body raises `SyntaxError` before anything is sent.
- Screenshots saved with a `path` are written under `artifact_root` (default: the
  current directory). A path must stay within it and must not pass through a
  symlink.
- `browser.close()` in run code closes the Stagehand and its browser once the
  call finishes (pass `on_close_requested` to own that cleanup); later calls fail.

This host has no keeper tab and does not latch session loss; the TypeScript
`StagehandFacadeTools` does both.

## Development

`src/stagehand_integrations/facade/_bundle.json` is a copy of the built bundle.
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
