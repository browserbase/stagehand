# TypeScript SDK

TypeScript object wrapper for the Stagehand v4 service-worker protocol.

```ts
import { Stagehand } from "@browserbasehq/stagehand-v4-spike-sdk-ts";

const stagehand = new Stagehand({ client });
await stagehand.init();

const page = (await stagehand.context.pages())[0] ?? (await stagehand.context.newPage());

await page.goto("https://example.com");
const currentUrl = await page.url();

await page.locator("#email").fill("user@example.com");
await page.locator("button[type=submit]").click();

await stagehand.close();
```

## object model

- `Stagehand` owns a protocol client and exposes `context`
- `BrowserContext.pages()` returns `Page` objects from `context.pages`
- `BrowserContext.newPage()` wraps the `context.new_page` result
- `Page` routes `goto`, `url`, `title`, and `close` to page protocol methods
- `Page.locator(selector)` creates a descriptor-backed `Locator`
- `Locator` routes `click`, `fill`, `isVisible`, and `textContent` to locator protocol methods

Locators are not remote handles. They store `{ pageId, selector }` and send that descriptor when an action is invoked.
