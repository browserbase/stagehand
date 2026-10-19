---
"@browserbasehq/stagehand-python": minor
---

add `Stagehand.run`, which runs Playwright-style code through the facade's Playwright-compatible runtime like the facade's `run` tool (screenshots saved with a `path` are written under `artifact_root`, `browser.close()` closes the Stagehand, and the code's own errors raise `PlaywrightRunError`), and `playwright_compat.playwright_batch_source`, which wraps such code for `experimental_batch`
