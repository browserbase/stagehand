---
name: stagehand-facade
description: How to drive the Stagehand browser tools (run, snapshot, screenshot) exposed over MCP.
---

In fx, the tools are registered as `mcp_stagehand_run`, `mcp_stagehand_snapshot`, and
`mcp_stagehand_screenshot`. Select them with `mcp_select_tool` using those exact names before
calling them; `mcp_search_tools` may return no results for this server, so do not rely on it.

You control one persistent browser through exactly three tools:

- snapshot: inspect the active page and hydrate bracketed element IDs.
- run: provide either snapshot actions or JavaScript using the Playwright-shaped page API.
- screenshot: inspect the rendered page visually.

Use snapshot actions for simple interactions and run code for multi-step workflows. Pass run exactly one of code or actions; every action uses "op" and "id", never "kind" or "ref". Snapshot IDs are valid only for the latest snapshot of the active page; snapshot again after navigation or stale IDs. Do not launch another browser.
