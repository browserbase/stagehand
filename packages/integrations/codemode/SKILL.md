# Stagehand V4 code-mode syntax

You have one code execution tool. Its `code` argument is the body of an async JavaScript function,
not a complete program. Write direct `await` statements and finish with a JSON-serializable return
value. Use the tool name supplied by the host framework.

The following objects are always in scope:

- `page`: the active Stagehand `Page`.
- `context`: the Stagehand `BrowserContext` shared across calls. In host code, this is
  `stagehand.browser.context`, not `stagehand.context`.
- `console`: captured `log`, `warn`, and `error` methods.

AI-enabled surfaces also inject:

- `stagehand`: the Stagehand AI methods `act`, `observe`, and `extract`.
- `z`: Zod V4 for `stagehand.extract` schemas.

If the host labels the surface deterministic, `stagehand` and `z` are intentionally unavailable.

Do not import packages, read environment variables, construct Stagehand, or close Stagehand or the
browser. The tool owner manages initialization and cleanup.

## Hard rules

1. Use deterministic page and locator methods first when the page structure is known or inspectable.
2. Treat the method lists below as allow-lists. Stagehand V4 is not Playwright; do not guess methods.
3. Await `page.url()`, `page.title()`, and every `context` method.
4. Stop when the requested evidence is complete. Do not re-fetch exact evidence with an AI method.
5. During pagination, stop on the first repeated row signature and return deduplicated records.

## Deterministic browser syntax

```js
await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
const heading = await page.locator("h1").innerText();
return { heading, url: await page.url(), title: await page.title() };
```

Supported page methods include `goto`, `reload`, `goBack`, `goForward`, `click`, `hover`, `scroll`,
`dragAndDrop`, `type`, `keyPress`, `evaluate`, `addInitScript`, `setExtraHTTPHeaders`,
`setViewportSize`, `waitForLoadState`, `waitForTimeout`, `waitForSelector`, `screenshot`, `snapshot`,
`tools`, `url`, `title`, and `locator`.

Supported locator methods include `click`, `hover`, `fill`, `count`, `isChecked`, `inputValue`,
`isVisible`, `innerText`, `innerHtml`, `textContent`, `scrollTo`, `centroid`, `highlight`,
`sendClickEvent`, `type`, `selectOption`, `setInputFiles`, `first`, and `nth`.

Supported context methods include `pages`, `newPage`, `activePage`, `setActivePage`,
`setExtraHTTPHeaders`, `getDomainPolicy`, `setDomainPolicy`, `cookies`, `addCookies`, and
`clearCookies`.

To submit a filled field with Enter, call `page.keyPress` with the key first. It does not take a
selector, and V4 does not expose `page.keyboard`:

```js
await page.locator('input[name="q"]').fill("vegetarian lasagna");
await page.keyPress("Enter");
```

Do not use Playwright-only methods such as locator `all`, `allTextContents`, `evaluate`,
`evaluateAll`, `filter`, `getAttribute`, `contentFrame`, or `innerHTML`; page `content`,
`frameLocator`, `frames`, or `keyboard`; or context `waitForEvent`. Use `innerHtml` with a lowercase
`l`.

For DOM collection reads, attributes, or custom traversal, use `page.evaluate`:

```js
const links = await page.evaluate(() =>
  Array.from(document.querySelectorAll("a")).map((a) => ({
    text: a.textContent?.trim() ?? "",
    href: a.getAttribute("href"),
  })),
);
return links;
```

## Stagehand AI syntax

Stagehand V4 AI methods return `{ data, metadata }`. Read the useful result from `.data`.

```js
const result = await stagehand.act("Click the sign-in button");
if (!result.data.success) throw new Error(result.data.message);
return result.data;
```

```js
const result = await stagehand.observe("Find the checkout button");
return result.data;
```

```js
const result = await stagehand.extract(
  "Extract the product name and price",
  z.object({ name: z.string(), price: z.string() }),
);
return result.data;
```

Pass `{ page: anotherPage }` as the final options object when an AI method should target a page
other than the active page.

## Pages and state across calls

```js
const before = await context.pages();
const current = before[before.length - 1];
await current.locator("button").first().click();
await current.waitForTimeout(500);
const after = await context.pages();
const opened = after[after.length - 1];
await context.setActivePage(opened);
return { pageCount: after.length, activeUrl: await opened.url() };
```

There is no `context.waitForEvent`. Detect a newly opened tab by comparing the awaited arrays from
`context.pages()` before and after the click. A click does not necessarily make the new tab active;
call `context.setActivePage(opened)` explicitly.

The same browser, pages, cookies, and navigation state persist across successful tool calls. Local
JavaScript variables do not persist, so rediscover pages and elements each call. If a call stops
responding, the owning framework should terminate and restart the tool process; the restarted
process begins with a new browser.

## Cross-origin iframes

Do not use `page.frameLocator()` or locator `contentFrame()`. Call `page.snapshot({ includeIframes:
true })`, locate the relevant accessibility reference in `formattedTree`, look up its frame-piercing
XPath in `xpathMap`, and use the XPath with the normal locator methods:

```js
const snapshot = await page.snapshot({ includeIframes: true });
const ref = "0-2"; // Discover the task-specific ref from formattedTree.
const xpath = snapshot.xpathMap[ref];
if (!xpath) throw new Error(`No XPath for accessibility ref ${ref}`);
const field = page.locator(`xpath=${xpath}`);
await field.fill("value");
return { value: await field.inputValue() };
```

## Efficient recovery

- Batch related deterministic operations when later steps depend on earlier state.
- If navigation or `setActivePage` times out, inspect current pages and URLs before repeating it.
- A failed `act`, `observe`, or `extract` does not destroy the browser. Continue with deterministic
  methods when possible.
- Pagination controls may be visually enabled without changing the rendered rows. Deduplicate rows
  and stop on the first repeated page signature.

## Return discipline

Return only compact evidence needed by the agent. Prefer strings, numbers, booleans, arrays, and
plain objects. Do not return Page, Locator, BrowserContext, Stagehand, or Zod objects. Await
asynchronous methods before returning.

For the newest exact declarations, inspect the installed `@browserbasehq/stagehand` TypeScript
declarations and this package's `codemode/REFERENCE.md` when filesystem access is available.
