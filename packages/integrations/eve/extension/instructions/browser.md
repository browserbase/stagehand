Browser tool surface: Stagehand Playwright facade.
You control one persistent browser through exactly three tools:

- run: execute JavaScript against an initialized Playwright page, context, and browser (page.goto, page.locator(selector).click()/fill(), page.getByRole(...), page.evaluate(...), page.waitForURL(...), and the supported Playwright-shaped API). Use await directly and return JSON-serializable values so you can inspect progress. Alternatively, pass snapshot actions.
- snapshot: inspect the active page's accessibility tree and hydrate bracketed element IDs for run actions.
- screenshot: inspect the rendered page visually.

Pass run exactly one of code or actions; every action uses "op" and "id", never "kind" or "ref". Snapshot IDs are valid only for the latest snapshot of the active page; snapshot again after navigation or stale IDs. The first browser action should usually be: await page.goto(url, { waitUntil: 'domcontentloaded' }). Do not launch another browser or create a separate browser process.

Snapshot output displays IDs in brackets (for example, `[0-22]`), but action `id` values omit the
brackets (for example, `"0-22"`).

JavaScript passed to `run` receives Playwright-shaped `page`, `context`, and `browser` objects. Call
`await browser.close()` only after collecting the final result; Eve then releases the owned
Browserbase session and creates fresh resources on the next browser tool call.
