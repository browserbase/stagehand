Use the Stagehand tools to control one persistent browser. Operations are serialized, and browser
state persists across calls.

- Use `snapshot` to inspect the active page. Its accessibility IDs are descriptive, not selectors.
- Use `run` for navigation and multi-step browser operations. It accepts the body of an async
  JavaScript function; write direct `await` statements and return a JSON-serializable result.
- Use `screenshot` when visual inspection is useful.

`run` provides `page`, `context`, `act`, `observe`, `extract`, and `close`. `page` is Stagehand v4's
`Page`, not a Playwright `Page`. Treat these method lists as allow-lists and do not guess Playwright
methods such as `getByRole`, `getByText`, `frameLocator`, or `keyboard`.

Supported page methods include `goto`, `reload`, `goBack`, `goForward`, `click`, `hover`, `scroll`,
`dragAndDrop`, `type`, `keyPress`, `evaluate`, `addInitScript`, `setExtraHTTPHeaders`,
`setViewportSize`, `waitForLoadState`, `waitForTimeout`, `waitForSelector`, `screenshot`, `snapshot`,
`tools`, `url`, `title`, `close`, and `locator`.

Supported locator methods include `click`, `hover`, `fill`, `count`, `isChecked`, `inputValue`,
`isVisible`, `innerText`, `innerHtml`, `textContent`, `scrollTo`, `centroid`, `highlight`,
`sendClickEvent`, `type`, `selectOption`, `setInputFiles`, `first`, and `nth`. Locators take CSS or
XPath selectors. For example:

```js
await page.goto("https://example.com", { waitUntil: "domcontentloaded" });
await page.locator("a").click();
return { title: await page.title(), url: await page.url() };
```

Use Stagehand's exact signatures: `page.setViewportSize(width, height)`, `page.keyPress(key)`, and
`locator.scrollTo(percent)`. A locator does not provide `press` or `keyPress`.

Supported context methods include `pages`, `newPage`, `activePage`, `setActivePage`,
`addInitScript`, `setExtraHTTPHeaders`, `getDomainPolicy`, `setDomainPolicy`, `cookies`,
`addCookies`, and `clearCookies`.

Await `page.url()`, `page.title()`, and every context method. Use `page.evaluate` for DOM queries or
attributes that the locator allow-list does not cover. Use `act`, `observe`, and `extract` for
AI-assisted operations. Do not import packages, access Node.js APIs, or launch another browser.

Call `close()` in the final `run` after collecting the result when the browser session is no longer
needed. It asks the host to release the owned browser after the callback returns.
