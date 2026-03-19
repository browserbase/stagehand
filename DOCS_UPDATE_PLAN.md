# Stagehand Documentation Update Plan
## Phases 5–8: Playwright-Native Mode

**Scope of work:** Document four shipped features across user-facing docs, reference pages,
and inline code comments. All changes are additive — no existing content needs to be removed.

---

## Background: What shipped in Phases 5–8

| Phase | Feature | User-visible change |
|-------|---------|---------------------|
| 5 | `browserContext` option | Run Stagehand on any Playwright `BrowserContext` — including Firefox/camoufox — without launching Chrome |
| 6 | DOM walker quality | Better accessible names (aria-hidden filtering, label-for association, ARIA state attrs) in snapshot output |
| 7 | Playwright ARIA engine | Stagehand's internal snapshot now uses Playwright's `_snapshotForAI` on Chromium ≥1.52, producing W3C-compliant accessible trees |
| 8 | `pierceShadow: "including-closed"` | Opt-in to pierce closed shadow roots (used by SAP, Salesforce, ServiceNow components) |

Phases 6 and 7 are **invisible quality improvements** — no API surface changes, nothing for users to configure. They need a single changelog entry and an optional "How it works" note in the browser config doc.

Phases 5 and 8 add **new public API** and need dedicated documentation.

---

## Part 1 — Changes to existing files

### 1.1 `packages/docs/v3/references/stagehand.mdx`

**What to do:** Add `browserContext` to the V3Options interface block and to the
`### Configuration Parameters` section as a `<ParamField>` entry.

**Location:** After the `env` ParamField (line ~75), add:

```mdx
<ParamField path="browserContext" type="BrowserContext">
  An externally-managed Playwright `BrowserContext` to wrap. When set, Stagehand
  skips all Chrome/Browserbase launch code and operates on the provided context
  directly. The caller is responsible for closing the context.

  Use this when you need to run Stagehand on a browser you control — for example
  a Firefox/camoufox instance, a persistent profile, or a browser launched with
  custom stealth settings.

  ```typescript
  import { chromium } from "playwright-core";
  import { Stagehand } from "@browserbasehq/stagehand";

  const browser = await chromium.connect({ wsEndpoint: process.env.CAMOUFOX_WS });
  const ctx = browser.contexts()[0] ?? await browser.newContext();

  const stagehand = new Stagehand({
    env: "LOCAL",      // required, but ignored for launch purposes
    browserContext: ctx,
    model: "openai/gpt-4.1-mini",
  });
  await stagehand.init();
  ```

  **Note:** `env` must still be set to `"LOCAL"` to satisfy the type system.
  The value is not used for browser launch when `browserContext` is provided.
</ParamField>
```

Also update the TypeScript interface block at the top to include `browserContext`:

```typescript
interface V3Options {
  env: "LOCAL" | "BROWSERBASE";

  // Externally-managed Playwright context (optional — see Playwright-Native Mode)
  browserContext?: BrowserContext;      // NEW

  // Browserbase options ...
  // Local browser options ...
  // AI/LLM configuration ...
  // Behavior options ...
  cacheDir?: string;
  serverCache?: boolean;
}
```

---

### 1.2 `packages/docs/v3/configuration/browser.mdx`

**What to do:** Add a new top-level section **"## Playwright-Native Mode"** after the
existing "## Local Environment" section (before "## Advanced Configuration").

**Proposed content:**

```mdx
## Playwright-Native Mode

Playwright-Native Mode lets you attach Stagehand to a `BrowserContext` you manage
yourself. Instead of launching Chrome, Stagehand wraps whatever Playwright browser
you hand it — Firefox, a custom Chromium build, a stealth browser like camoufox,
or a persistent profile with saved cookies.

### When to use it

- **Firefox or camoufox** — bypass bot-detection systems that fingerprint Chrome
- **Custom profiles** — bring a browser with existing cookies, extensions, or settings
- **Test environments** — wire Stagehand to a Playwright browser already under test
- **Enterprise stealth** — your organization manages its own browser infrastructure

### Quick start (camoufox)

1. Start camoufox and copy the WebSocket URL it prints:
   ```
   ws://localhost:42797/9e2abceb2cbd8d8595f441890e50815f
   ```

2. Set `CAMOUFOX_WS` in your `.env`:
   ```bash
   CAMOUFOX_WS=ws://localhost:42797/<token>
   ```

3. Connect and wrap:
   ```typescript
   import { chromium } from "playwright-core";
   import { Stagehand } from "@browserbasehq/stagehand";

   const browser = await chromium.connect({ wsEndpoint: process.env.CAMOUFOX_WS! });
   const ctx  = browser.contexts()[0] ?? await browser.newContext();
   const page = ctx.pages()[0] ?? await ctx.newPage();

   const stagehand = new Stagehand({
     env: "LOCAL",
     browserContext: ctx,
     model: "openai/gpt-4.1-mini",
   });
   await stagehand.init();

   await page.goto("https://example.com");

   const result = await stagehand.extract(
     "extract the page heading",
     z.string(),
     { page },
   );
   ```

<Note>
Pass the Playwright `page` object to `act()`, `extract()`, and `observe()` via the
`{ page }` option when using an external context. Stagehand needs to know which
page to operate on.
</Note>

### Quick start (any Playwright browser)

```typescript
import { firefox } from "playwright-core"; // or chromium, webkit
import { Stagehand } from "@browserbasehq/stagehand";

const browser = await firefox.launch({ headless: false });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const stagehand = new Stagehand({
  env: "LOCAL",
  browserContext: ctx,
  model: "openai/gpt-4.1-mini",
});
await stagehand.init();
await stagehand.close();           // closes Stagehand; ctx/browser are yours to close
await browser.close();
```

### Comparison table

| | `env: "LOCAL"` | `env: "LOCAL"` + `browserContext` |
|---|---|---|
| Browser | Stagehand launches Chrome | You provide any Playwright browser |
| Firefox support | No | Yes |
| Stealth browser (camoufox) | No | Yes |
| Persistent profiles | Via `userDataDir` | Via your own context setup |
| CDP features | Full | None — pure Playwright API |
| `stagehand.context` | Managed internally | Points to your context |
| Closing browser | `stagehand.close()` handles it | Your responsibility |

### Known limitations

Playwright-Native Mode uses only Playwright's public API. Some features that rely on
Chrome DevTools Protocol (CDP) are not available:

- **Element highlight** — `.highlight()` calls on locators are a no-op; no visual overlay
- **`addInitScript()` scope** — scripts are installed context-wide, affecting all pages
- **FlowLogger decorators** — flow logging events are not emitted in this mode
- **`evaluate()` string expressions** — must pass a function, not a string

These limitations apply only when `browserContext` is set. Normal `env: "LOCAL"` and
`env: "BROWSERBASE"` modes are unchanged.

### Shadow DOM and enterprise components

Enterprise applications (SAP Fiori, Salesforce Lightning, ServiceNow) often use
**closed shadow roots** to encapsulate their UI components. By default, Stagehand
cannot see inside closed shadow roots because `el.shadowRoot` is always `null`.

To enable full shadow DOM traversal, pass `pierceShadow: "including-closed"` when
requesting a snapshot:

```typescript
// In a low-level snapshot call or via the internal captureSnapshot option
// See the Shadow DOM guide for full usage
```

See **Shadow DOM Piercing** in Best Practices for the complete guide.
```

---

### 1.3 `packages/docs/v3/best-practices/caching.mdx`

**What to do:** Add a callout in the "Local Cache" section noting that local caching
works with all browser modes, including Playwright-Native Mode.

**Location:** After the introductory paragraph of "## Local Cache" (after line ~79):

```mdx
<Tip>
Local Cache (`cacheDir`) works in all three browser modes: `env: "BROWSERBASE"`,
`env: "LOCAL"` (Chrome), and `env: "LOCAL"` with an external `browserContext`
(Firefox, camoufox, etc.). The cache is keyed by instruction + page URL, so the
same automation replay correctly regardless of which browser it runs in.
</Tip>
```

Also add a note about how to observe cache hits in native mode (since `ActResult.cacheStatus`
is only populated by the Browserbase server cache, not the local file cache):

**Location:** After "### Inspecting Cache Status" in the Browserbase Cache section,
add a new sub-section:

```mdx
#### Inspecting Local Cache Status

The `cacheStatus` field on `ActResult` reflects **server-side** (Browserbase) cache hits only.
For local file cache (`cacheDir`), use the `logger` option to observe hits:

```typescript
const stagehand = new Stagehand({
  env: "LOCAL",
  cacheDir: ".cache/my-flow",
  logger: (line) => {
    if (line.category === "cache" && line.message?.includes("act cache hit")) {
      console.log("Cache HIT:", line.auxiliary?.instruction?.value);
    }
  },
});
```
```

---

### 1.4 `packages/docs/v3/references/act.mdx`

**What to do:** Add `page` to the `ActOptions` parameter table. It's currently undocumented.

**Add this ParamField entry** in the options section:

```mdx
<ParamField path="options.page" type="PlaywrightPage | PlaywrightNativePage">
  The specific page to act on. Required when using Playwright-Native Mode
  (`browserContext` option) with multiple open pages. When omitted, Stagehand
  uses its internally managed page.

  ```typescript
  await stagehand.act("click the submit button", { page: pwPage });
  ```
</ParamField>
```

Apply the same addition to `extract.mdx` and `observe.mdx` (same `page` option exists on
`ExtractOptions` and `ObserveOptions`).

---

## Part 2 — New files to create

### 2.1 `packages/docs/v3/best-practices/shadow-dom.mdx`

**Title:** Shadow DOM Automation
**Sidebar title:** Shadow DOM
**Description:** Automate open and closed shadow root components in enterprise apps

**Full proposed content:**

```mdx
---
title: Shadow DOM Automation
sidebarTitle: Shadow DOM
description: Automate open and closed shadow root components in enterprise apps
---
import { V3Banner } from '/snippets/v3-banner.mdx';

<V3Banner />

Shadow DOM components encapsulate their HTML in a private tree that is invisible to
standard DOM queries. Enterprise applications in particular — SAP Fiori, Salesforce
Lightning, ServiceNow, many web component libraries — make heavy use of shadow roots
to prevent style and script leakage.

Stagehand supports two levels of shadow DOM piercing controlled by the `pierceShadow`
snapshot option.

## Open shadow roots

Open shadow roots (`attachShadow({ mode: "open" })`) are pierced automatically.
No configuration is needed — `act()`, `extract()`, and `observe()` all see inside
open shadows by default.

## Closed shadow roots

Closed shadow roots (`attachShadow({ mode: "closed" })`) set `el.shadowRoot = null`,
making them invisible to standard DOM queries. Stagehand adds opt-in support via the
`pierceShadow: "including-closed"` option, which installs a lightweight
`attachShadow` interceptor as a page init script before any page content loads.

### How it works

When `pierceShadow: "including-closed"` is first used on a page, Stagehand:

1. Installs an `addInitScript` that wraps `Element.prototype.attachShadow`
2. Any subsequent call to `attachShadow({ mode: "closed" })` on that page stores the
   shadow root in a `WeakMap`
3. Stagehand's DOM walker reads the map via `window.__stagehandClosedRoot(host)`
4. The snapshot includes closed shadow content alongside regular and open-shadow DOM

<Warning>
`addInitScript` takes effect on the **next navigation only**. If the page has
already loaded content with closed shadow roots before this option is first used,
those roots will be invisible. Navigate or reload the page after calling
`captureSnapshot({ pierceShadow: "including-closed" })` for the first time.
</Warning>

### Usage

The `pierceShadow` option is passed at the snapshot level:

```typescript
import { chromium } from "playwright-core";
import { Stagehand } from "@browserbasehq/stagehand";

const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const stagehand = new Stagehand({
  env: "LOCAL",
  browserContext: ctx,
  model: "openai/gpt-4.1-mini",
});
await stagehand.init();

// Step 1: Enable the interceptor (installs init script)
// Must happen before the page content that creates shadow roots is loaded
await stagehand.page.captureSnapshot({ pierceShadow: "including-closed" });

// Step 2: Navigate — init script runs before any inline <script> on the page
await page.goto("https://your-sap-or-salesforce-app.example.com");

// Step 3: Normal act/extract/observe — closed shadow content is now visible
await stagehand.act("click the 'Submit' button inside the form component");
```

### Comparison

| `pierceShadow` value | Open shadow roots | Closed shadow roots |
|---|---|---|
| `false` | Not pierced | Not pierced |
| `true` (default) | **Pierced** | Not pierced |
| `"including-closed"` | **Pierced** | **Pierced** |

### Known side effects

- **Context-wide installation.** `addInitScript` installs the interceptor on all
  pages in the `BrowserContext`, not only the page that first requested it. Other
  pages you open will also carry the `__stagehandClosedRoot` global.

- **Pre-existing roots invisible.** Shadow roots attached before the init script
  ran are not captured. Always navigate after enabling `"including-closed"`.

- **XPath limitations.** Elements inside closed shadow roots receive XPaths that
  truncate at the shadow host boundary (`/html[1]/body[1]/section[1]/`). These paths
  are non-unique and may match multiple elements. Use accessible names or ARIA roles
  in your instructions instead of relying on XPath precision for closed-shadow elements.

### When not to use it

Closed shadow DOM piercing modifies `Element.prototype.attachShadow` via an init
script. This is detectable by anti-bot systems. Do not use `"including-closed"` on
pages that actively check for DOM prototype modifications.
```

---

### 2.2 `packages/docs/v3/configuration/playwright-native.mdx`

**Title:** Playwright-Native Mode
**Sidebar title:** Playwright-Native
**Description:** Attach Stagehand to any Playwright browser context — Firefox, camoufox, custom builds

This is a dedicated reference page extracted from the content proposed for `browser.mdx`
above. Create it so the camoufox/Firefox workflow has a canonical home with a URL users
can bookmark and share. The `browser.mdx` changes above can link to it.

**Content outline:**
1. What it is (1 paragraph)
2. Prerequisites (playwright-core installed, any browser)
3. Connecting to camoufox (step-by-step with env var)
4. Connecting to Firefox (plain launch)
5. Connecting to an existing Playwright test browser
6. Passing `page` to act/extract/observe
7. Local caching with external contexts
8. Limitations (CDP-dependent features not available)
9. Troubleshooting

---

## Part 3 — Navigation updates (`packages/docs/docs.json`)

### 3.1 Add new pages to navigation

In the `"Best Practices"` group, add after `"v3/best-practices/computer-use"`:

```json
"v3/best-practices/shadow-dom"
```

In the `"Configuration"` group, add after `"v3/configuration/browser"`:

```json
"v3/configuration/playwright-native"
```

---

## Part 4 — CHANGELOG entries

### `packages/core/CHANGELOG.md`

Add a new entry at the top (under the next version heading):

```markdown
### New Features

#### Playwright-Native Mode (`browserContext` option)
Pass an externally-managed Playwright `BrowserContext` to `new Stagehand({ browserContext })`.
Stagehand wraps it with a pure-Playwright implementation — no CDP required.
Enables Firefox, camoufox, and any other Playwright-compatible browser.

#### `pierceShadow: "including-closed"` snapshot option
Opt in to closed shadow DOM traversal via an `attachShadow` interceptor init script.
Enables automation of SAP Fiori, Salesforce Lightning, ServiceNow, and similar
enterprise components that use `{ mode: "closed" }` shadow roots.

### Improvements

#### DOM walker quality (Phase 6)
- `getAccessibleName()` now skips `aria-hidden` subtrees per the accname-1.1 spec —
  elements marked `aria-hidden="true"` no longer contribute text to their ancestors' names
- `label[for]` association resolves accessible names on inputs that lack `aria-label`
- `aria-expanded`, `aria-checked`, `aria-selected`, `aria-disabled` captured in snapshot

#### Playwright ARIA engine (Phase 7)
On Playwright ≥ 1.52 (Chromium), Stagehand's snapshot engine switches to
`page._snapshotForAI()`, which returns a W3C-compliant ARIA tree with ref-to-XPath
resolution. This produces higher-quality accessible names than the DOM walker,
particularly for complex components. Falls back to the DOM walker automatically on
older Playwright versions and Firefox.
```

---

## Part 5 — Code-level JSDoc gaps

These are gaps in inline documentation not covered by the MDX pages.

### 5.1 `packages/core/lib/v3/types/private/snapshot.ts`

`SnapshotOptions.pierceShadow` already has a comment but it should mention the
`"including-closed"` value explicitly with a link to the docs:

```typescript
/**
 * Controls shadow DOM traversal depth.
 *
 * - `false`                  — no shadow piercing
 * - `true` (default)         — pierce open shadow roots only
 * - `"including-closed"`     — pierce open AND closed shadow roots via
 *                              an `attachShadow` interceptor init script.
 *                              See: https://docs.stagehand.dev/v3/best-practices/shadow-dom
 *
 * IMPORTANT: "including-closed" only captures roots attached *after* the
 * init script runs. Navigate the page after first enabling this option.
 */
pierceShadow?: boolean | "including-closed";
```

### 5.2 `packages/core/lib/v3/types/public/options.ts`

`V3Options.browserContext` already has a JSDoc comment (added in Phase 5).
Add a link to the docs page:

```typescript
/**
 * Optional: provide an externally-managed Playwright BrowserContext.
 * ...existing text...
 *
 * See: https://docs.stagehand.dev/v3/configuration/playwright-native
 */
browserContext?: BrowserContext;
```

### 5.3 `packages/core/lib/v3/understudy/native/PlaywrightNativePage.ts`

The file-level comment block already lists Phase 4 limitations. Add a reference
to the public docs:

```typescript
/**
 * PlaywrightNativePage — Playwright-public-API implementation of IStagehandPage.
 *
 * ...existing limitation list...
 *
 * Public docs: https://docs.stagehand.dev/v3/configuration/playwright-native
 */
```

---

## Part 6 — README update

### `packages/core/README.md` (mirrors root `README.md`)

The README currently only mentions `env: "BROWSERBASE"` and `env: "LOCAL"`.
Add a brief callout in the "Quick Start" or "Configuration" section:

```markdown
### Using Stagehand with Firefox or camoufox

Pass an external Playwright `BrowserContext` to run Stagehand on any browser:

```typescript
import { chromium } from "playwright-core";
import { Stagehand } from "@browserbasehq/stagehand";

const browser = await chromium.connect({ wsEndpoint: process.env.CAMOUFOX_WS });
const stagehand = new Stagehand({
  env: "LOCAL",
  browserContext: browser.contexts()[0],
  model: "openai/gpt-4.1-mini",
});
await stagehand.init();
```

See [Playwright-Native Mode](https://docs.stagehand.dev/v3/configuration/playwright-native) for the full guide.
```

---

## Priority order

| Priority | Work item | Effort | Impact |
|----------|-----------|--------|--------|
| 1 (High) | Create `playwright-native.mdx` | ~3h | New users can't find the feature without this |
| 1 (High) | Update `stagehand.mdx` with `browserContext` ParamField | ~30m | Reference docs are incomplete |
| 2 (High) | Update `browser.mdx` with native mode section | ~2h | Discoverability from existing browser config page |
| 3 (Medium) | Create `shadow-dom.mdx` | ~2h | Enterprise users need this, but it's a niche feature |
| 4 (Medium) | Update `caching.mdx` with native mode note | ~30m | Prevents confusion about `cacheStatus` behavior |
| 5 (Medium) | Update `act.mdx`, `extract.mdx`, `observe.mdx` with `page` param | ~1h | Reference completeness |
| 6 (Medium) | Update `docs.json` navigation | ~15m | Required once new pages exist |
| 7 (Low) | CHANGELOG entries | ~30m | Useful for release notes |
| 8 (Low) | README callout | ~15m | Nice-to-have discoverability |
| 9 (Low) | JSDoc improvements in `snapshot.ts` and `options.ts` | ~30m | IDE documentation quality |

---

## Files touched summary

| File | Action |
|------|--------|
| `packages/docs/v3/references/stagehand.mdx` | Edit — add `browserContext` ParamField |
| `packages/docs/v3/configuration/browser.mdx` | Edit — add Playwright-Native section |
| `packages/docs/v3/best-practices/caching.mdx` | Edit — add native mode tip + logger note |
| `packages/docs/v3/references/act.mdx` | Edit — add `page` option |
| `packages/docs/v3/references/extract.mdx` | Edit — add `page` option |
| `packages/docs/v3/references/observe.mdx` | Edit — add `page` option |
| `packages/docs/v3/configuration/playwright-native.mdx` | **Create** |
| `packages/docs/v3/best-practices/shadow-dom.mdx` | **Create** |
| `packages/docs/docs.json` | Edit — add 2 entries to navigation |
| `packages/core/CHANGELOG.md` | Edit — add Phase 5–8 entries |
| `packages/core/README.md` | Edit — add native mode callout |
| `packages/core/lib/v3/types/private/snapshot.ts` | Edit — expand pierceShadow JSDoc |
| `packages/core/lib/v3/types/public/options.ts` | Edit — add docs link to browserContext JSDoc |
| `packages/core/lib/v3/understudy/native/PlaywrightNativePage.ts` | Edit — add docs link to file comment |

**Total: 8 edits + 2 new files**
