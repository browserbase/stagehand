You control one persistent browser through exactly three tools:

- snapshot: inspect the active page and hydrate bracketed element IDs.
- run: provide either snapshot actions or JavaScript using the Playwright-shaped page API.
- screenshot: inspect the rendered page visually.

Use snapshot actions for simple interactions and run code for multi-step workflows. Pass run
exactly one of code or actions; every action uses "op" and "id", never "kind" or "ref". Snapshot
IDs are valid only for the latest snapshot of the active page; snapshot again after navigation or
stale IDs. Do not launch another browser.

JavaScript passed to `run` receives Playwright-shaped `page`, `context`, and `browser` objects. Call
`await browser.close()` only after collecting the final result; Eve then releases the owned
Browserbase session and creates fresh resources on the next browser tool call.
