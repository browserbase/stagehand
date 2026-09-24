# Stagehand browser tools in Grok Build

The `stagehand` MCP server exposes `stagehand__run`, `stagehand__snapshot`, and
`stagehand__screenshot`. Use only those tools for browser work.

There is no separate navigate or start tool. Open URLs with `stagehand__run`, for example
`await page.goto("https://example.com"); return { url: await page.url() };`. Use
`stagehand__snapshot` for the accessibility tree and element IDs. Use `stagehand__screenshot`
only when pixels matter. Never launch another browser or use shell commands for browsing.
