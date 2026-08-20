---
name: stagehand-facade
description: Browse, navigate, inspect, screenshot, and automate websites with the exact fx tools mcp_stagehand_run, mcp_stagehand_snapshot, and mcp_stagehand_screenshot.
---

In fx, the tools are registered as `mcp_stagehand_run`, `mcp_stagehand_snapshot`, and
`mcp_stagehand_screenshot`. Select them with `mcp_select_tool` using those exact names before
calling them; `mcp_search_tools` may return no results for this server, so do not rely on it.
Never invent another Stagehand tool name. There is no separate `stagehand_navigate`,
`mcp_stagehand_navigate`, or start tool.

You control one persistent browser through exactly three tools:

- snapshot: inspect the active page and hydrate bracketed element IDs.
- run: browse or navigate with JavaScript (for example, `await page.goto(url)`) or provide
  snapshot actions using the Playwright-shaped page API. The first call initializes the browser.
- screenshot: inspect the rendered page visually. Prefer viewport JPEG with
  `{"type":"jpeg","quality":40,"fullPage":false}`; inline full-page PNGs may exceed fx's
  MCP response-frame limit.

Use snapshot actions for simple interactions and run code for multi-step workflows. Pass run exactly one of code or actions; every action uses "op" and "id", never "kind" or "ref". Snapshot IDs are valid only for the latest snapshot of the active page; snapshot again after navigation or stale IDs. Do not launch another browser.
