# Smoke-test WebMCP before production

Load a real page in local Chromium, require a named tool from `page.tools()`, invoke it, and fail unless it completes. The default page is `https://browserbase.github.io/stagehand-eval-sites/sites/webmcp-test/`, the tool is `calculateSum`, and the input is `{"a":19,"b":23}`.

Set `WEBMCP_URL`, `WEBMCP_TOOL`, and `WEBMCP_INPUT` (a JSON object) for your app. This local-browser example needs no API keys. It checks tool registration on the actual page rather than a copy of its handlers.

- TypeScript: `cd typescript && cp .env.example .env && pnpm install && pnpm start`
- Python: `cd python && cp .env.example .env && uv sync && uv run python main.py`
- Go: `cd go && go run .` (export any overrides)

A page with no WebMCP tools, a missing tool, invalid input, or a result other than `Completed` exits nonzero.
