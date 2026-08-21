# Stagehand browser tools in fx

The Stagehand MCP server exposes exactly these three fx tool names:

- `mcp_stagehand_run`
- `mcp_stagehand_snapshot`
- `mcp_stagehand_screenshot`

Select the needed tools directly with `mcp_select_tool`. Do not rely on
`mcp_search_tools`, which may return no results for this server, and never invent a
Stagehand tool name.

There is no separate Stagehand `navigate` or `start` tool. To open or browse a URL,
call `mcp_stagehand_run` with JavaScript such as
`await page.goto("https://example.com"); return { url: await page.url() };`. The first
call initializes the persistent browser session.

Use `mcp_stagehand_snapshot` for the accessibility tree and bracketed element IDs.
Use `mcp_stagehand_screenshot` only when visual pixels are needed. Prefer
`{"type":"jpeg","quality":40,"fullPage":false}` because inline full-page PNGs can
exceed fx's MCP response-frame limit.
