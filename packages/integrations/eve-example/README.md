# Browserbase Eve example

This private workspace exercises the published shape of `@browserbasehq/eve`. It mounts the local
package under `browserbase`, while Eve remains the agent and Stagehand V4 Code Mode controls the
Browserbase session.

Set `BROWSERBASE_API_KEY` and an Eve model credential, then run:

```bash
pnpm --filter @browserbasehq/stagehand-integrations-example-eve dev
```

Example task:

```text
Open https://example.com, inspect the page, follow the Learn more link, report the final title and
URL, then close the browser.
```
