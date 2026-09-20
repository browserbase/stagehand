# Stagehand browser tools in Cursor

The `stagehand` MCP server exposes the `run`, `snapshot`, and `screenshot` tools. Cursor surfaces
MCP tools by server and tool name; use the tools belonging to the `stagehand` server.

There is no separate navigate or start tool. Open URLs with `run`, for example
`await page.goto("https://example.com"); return { url: await page.url() };`. Use `snapshot` for
the accessibility tree and element IDs, and `screenshot` only when visual pixels are needed.
Never launch a separate browser or use shell commands for browsing.
