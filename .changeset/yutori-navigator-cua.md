---
"@browserbasehq/stagehand": patch
---

Add Yutori Navigator n1.5 as a computer-use (CUA) agent provider, usable via `stagehand.agent({ mode: "cua", model: "yutori/n1.5-latest" })` (auth via `YUTORI_API_KEY`). OpenAI-compatible computer-use model integrated alongside the existing OpenAI/Anthropic/Google/Microsoft CUA clients, with no new dependencies.

Defaults to Navigator's expanded tool set (`browser_tools_expanded-20260403`): on top of the coordinate tools, the model gets the accessibility-backed DOM tools `extract_elements`, `find`, `set_element_value`, and `execute_js` (built on Stagehand's hybrid a11y snapshot + `deepLocator`), and the coordinate tools can target an element by `ref` (resolved to its on-screen center). Pass `toolSet: "browser_tools_core-20260403"` for coordinate-only behavior.
