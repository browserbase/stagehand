# Stagehand V4 code-mode reference

This reference describes the Stagehand objects injected into `code_execute`. `SKILL.md` contains the
short operational guide intended for every agent context; this file is the longer lookup reference.

## Function body contract

The tool builds an async function from the submitted body. These values are injected:

```ts
page: Page;
context: BrowserContext;
stagehand: Stagehand;
z: typeof import("zod/v4");
console: Pick<Console, "log" | "warn" | "error">;
```

Eval harnesses may add JSON-safe bindings such as `startUrl` and `task`. The deterministic eval arm
intentionally omits `stagehand` and `z`.

## Page

Navigation and page state:

```ts
page.goto(url, { waitUntil?, timeout? }): Promise<Response | null>
page.reload(options?): Promise<Response | null>
page.goBack(options?): Promise<Response | null>
page.goForward(options?): Promise<Response | null>
page.url(): Promise<string>
page.title(): Promise<string>
page.pageId: string
page.close(): Promise<void>
```

Input and pointer operations:

```ts
page.click(x, y, options?): Promise<void>
page.hover(x, y): Promise<void>
page.scroll(x, y, deltaX, deltaY): Promise<void>
page.dragAndDrop(fromX, fromY, toX, toY, options?): Promise<void>
page.type(text, options?): Promise<void>
page.keyPress(key, options?): Promise<void>
```

DOM and setup operations:

```ts
page.evaluate(expressionOrFunction, arg?): Promise<unknown>
page.addInitScript(script, arg?): Promise<void>
page.setExtraHTTPHeaders(headers): Promise<void>
page.setViewportSize(width, height, options?): Promise<void>
page.waitForLoadState('load' | 'domcontentloaded' | 'networkidle', timeout?): Promise<void>
page.waitForTimeout(milliseconds): Promise<void>
page.waitForSelector(selector, options?): Promise<boolean>
page.screenshot(options?): Promise<Buffer>
page.snapshot({ includeIframes? }): Promise<{ formattedTree; xpathMap; urlMap }>
page.locator(selector): Locator
```

`page.evaluate` accepts a function and one serializable argument. Prefer one object when several
values are needed:

```js
return await page.evaluate(
  ({ selector, limit }) =>
    Array.from(document.querySelectorAll(selector))
      .slice(0, limit)
      .map((node) => node.textContent?.trim() ?? ""),
  { selector: "article h2", limit: 20 },
);
```

## Locator

```ts
locator.click(options?): Promise<void>
locator.hover(): Promise<void>
locator.fill(value): Promise<void>
locator.count(): Promise<number>
locator.isChecked(): Promise<boolean>
locator.inputValue(): Promise<string>
locator.isVisible(): Promise<boolean>
locator.innerText(): Promise<string>
locator.innerHtml(): Promise<string>
locator.textContent(): Promise<string>
locator.scrollTo(percent): Promise<void>
locator.centroid(): Promise<{ x: number; y: number }>
locator.highlight(options?): Promise<void>
locator.sendClickEvent(options?): Promise<void>
locator.type(text, options?): Promise<void>
locator.selectOption(values): Promise<string[]>
locator.setInputFiles(files): Promise<void>
locator.first(): Locator
locator.nth(index): Locator
```

Stagehand locators do not implement Playwright's collection/filter/frame helpers. Use `count` with
`nth`, or use `page.evaluate` for bulk DOM reads.

## BrowserContext

```ts
context.pages(): Promise<Page[]>
context.newPage(options?): Promise<Page>
context.activePage(): Promise<Page | undefined>
context.setActivePage(page): Promise<void>
context.setExtraHTTPHeaders(headers): Promise<void>
context.getDomainPolicy(): Promise<DomainPolicy | null>
context.setDomainPolicy(policy: DomainPolicy | null): Promise<void>
context.cookies(urls?): Promise<Cookie[]>
context.addCookies(cookies): Promise<void>
context.clearCookies(options?): Promise<void>
```

The tool owner closes the context and browser. Generated code should not call `context.close()`,
`stagehand.close()`, or `stagehand.browser.close()`.

## Stagehand AI methods

```ts
stagehand.act(instruction, options?): Promise<{
  data: { success; message; actionDescription; actions };
  metadata: StagehandResultMetadata;
}>

stagehand.observe(instruction?, options?): Promise<{
  data: Action[];
  metadata: StagehandResultMetadata;
}>

stagehand.extract(instruction, schema?, options?): Promise<{
  data: unknown;
  metadata: StagehandResultMetadata;
}>
```

The useful operation result is under `.data`. The `.metadata` object contains cache and model-usage
information for that operation.

To target a non-active page:

```js
const pages = await context.pages();
const result = await stagehand.extract("Extract the heading", z.object({ heading: z.string() }), {
  page: pages[1],
});
return result.data;
```

## Multiple pages

Page arrays are snapshots. Await `context.pages()` again after an interaction that may open or
close a tab. Use `context.setActivePage(page)` when later operations should target that tab.

```js
const before = await context.pages();
const beforePageIds = new Set(before.map((page) => page.pageId));
await before[0].locator('a[target="_blank"]').first().click();
await before[0].waitForTimeout(500);
const after = await context.pages();
const opened = after.find((candidate) => !beforePageIds.has(candidate.pageId));
if (!opened) throw new Error("Expected a new page");
await context.setActivePage(opened);
return await opened.url();
```

## Pagination pattern

```js
const records = new Map();
const seenPages = new Set();

for (let pageIndex = 0; pageIndex < 50; pageIndex++) {
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll("table tbody tr")).map((row) =>
      Array.from(row.querySelectorAll("td")).map((cell) => cell.textContent?.trim() ?? ""),
    ),
  );
  const signature = JSON.stringify(rows);
  if (seenPages.has(signature)) break;
  seenPages.add(signature);
  for (const row of rows) records.set(JSON.stringify(row), row);

  const next = page.locator(".paginate_button.next").first();
  if (!(await next.isVisible())) break;
  await next.click();
  await page.waitForTimeout(300);
}

return Array.from(records.values());
```

## Common incompatibilities

| Incorrect assumption           | Stagehand V4 form                                           |
| ------------------------------ | ----------------------------------------------------------- |
| `page.url` is a string         | `await page.url()`                                          |
| `page.content()`               | `await page.locator('body').innerHtml()` or `page.evaluate` |
| `locator.innerHTML()`          | `await locator.innerHtml()`                                 |
| `locator.all()`                | `count()` plus `nth(index)`                                 |
| `locator.evaluate()`           | `page.evaluate()`                                           |
| `page.frameLocator()`          | `page.snapshot({ includeIframes: true })` plus `xpathMap`   |
| `context.waitForEvent('page')` | Compare `await context.pages()` before and after            |
| `result.success` from `act`    | `result.data.success`                                       |
| Raw array from `observe`       | `result.data`                                               |
| Raw object from `extract`      | `result.data`                                               |

When this reference and the installed SDK disagree, the installed `@browserbasehq/stagehand`
TypeScript declaration files are authoritative.
