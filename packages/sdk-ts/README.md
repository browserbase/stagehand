# TypeScript SDK

TypeScript object wrapper for the Stagehand v4 service-worker protocol.

```ts
import { localBrowser, Stagehand } from "@browserbasehq/stagehand";

const browser = await localBrowser.launch({ headless: true });
const stagehand = await Stagehand.create({ browser });
const page = (await stagehand.context.pages())[0] ?? (await stagehand.context.newPage());

const response = await page.goto("https://example.com");
if (response) {
  console.log(response.status(), await response.text());
}
const currentUrl = await page.url();

const actions = await stagehand.observe("Find the sign-in button");
await stagehand.act("Click the sign-in button");

await page.locator("#email").fill("user@example.com");
await page.locator("button[type=submit]").click();

await stagehand.close();
await browser.close();
```

## object model

- `localBrowser` and `browserbase` launch or connect an extension-ready browser
- `Stagehand.create()` attaches to a browser and exposes `context`
- `Stagehand.close()` closes the Stagehand runtime; `browser.close()` owns browser cleanup
- `Stagehand.act()`, `Stagehand.observe()`, and `Stagehand.extract()` use the active page by default and accept an SDK `Page` in their options
- `BrowserContext.pages()` returns `Page` objects from `context.pages`
- `BrowserContext.newPage()` wraps the `context.new_page` result
- `Page.goto()`, `reload()`, `goBack()`, and `goForward()` return the main-document `Response`, or `null` when navigation does not produce one
- `Response` exposes immediate status and header metadata and retrieves complete headers and bodies lazily
- `Page` routes `url`, `title`, and `close` to page protocol methods
- `Page.locator(selector)` creates a descriptor-backed `Locator`
- `Locator` routes `click`, `fill`, `isVisible`, and `textContent` to locator protocol methods

Locators are not remote handles. They store `{ pageId, selector }` and send that descriptor when an action is invoked.
