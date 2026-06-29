/**
 * Run bench `extract` / `act` / `observe` tasks against the Stagehand **v4** SDK,
 * single model, via a `V3`-shaped facade. Exposes the surface bench tasks touch —
 * `context.pages()/awaitActivePage()`, per-page `goto`/`url`/`evaluate`/`locator`
 * (incl. same-origin `frameLocator`), and `v3.act`/`extract`/`observe` (with an
 * optional `{ page }` target) — backed by the vendored v4 client.
 *
 * Enabled via `EVAL_SDK=v4` in benchHarness (extract/act/observe categories).
 * Reuses the v4 bundle + browser-extension wiring built for the
 * `stagehand_v4_code` CORE tool (vendor/stagehand-v4.js + the dist/cli zip).
 */
import { z, type ZodType } from "zod";
import {
  loadApiKeyFromEnv,
  type AvailableModel,
} from "@browserbasehq/stagehand";
import type { EvalLogger } from "../logger.js";
import type { V3InitResult } from "../initV3.js";
import type {
  StagehandClient as V4StagehandClient,
  V4Browser,
  V4Page,
} from "../core/tools/vendor/stagehand-v4.js";

interface ZodRegistryLike {
  _idmap: Map<string, unknown>;
  add: (schema: unknown, ...meta: unknown[]) => unknown;
  __shLenientIds?: boolean;
}

/**
 * Mirror of the helper in `core/tools/stagehand_v4_code.ts`: v3 and v4 both
 * register `.meta({ id })` schemas into zod's process-global registry, with
 * overlapping ids. Make duplicate-id registration a no-op so both SDKs coexist.
 */
async function tolerateDuplicateZodIds(): Promise<void> {
  const { globalRegistry } = (await import("zod")) as unknown as {
    globalRegistry?: ZodRegistryLike;
  };
  if (!globalRegistry || globalRegistry.__shLenientIds) return;
  const original = globalRegistry.add.bind(globalRegistry);
  globalRegistry.add = (schema: unknown, ...meta: unknown[]): unknown => {
    const first = meta[0];
    const id =
      first && typeof first === "object" && "id" in first
        ? (first as { id?: unknown }).id
        : undefined;
    if (typeof id === "string" && globalRegistry._idmap.has(id)) {
      return globalRegistry;
    }
    return original(schema, ...meta);
  };
  globalRegistry.__shLenientIds = true;
}

// provider (from "provider/model") -> the ExtensionUISetOptions key name.
const PROVIDER_KEY_OPTION: Record<string, string> = {
  anthropic: "anthropic_api_key",
  openai: "openai_api_key",
  google: "gemini_api_key",
};

type Loc = { css?: string; xpath?: string };
interface ExtractOpts {
  selector?: string;
  page?: V4BenchPage;
}

function pageIdOf(page: V4Page): string {
  return String(page.targetId ?? page.tabId ?? page.page_idx ?? "");
}

// v4's browser.pages() includes junk tabs (a default about:blank, chrome://newtab,
// chrome-error://, devtools://). Only real content tabs count as task pages.
const CONTENT_URL = /^(https?|file|data):/i;
function isContentTab(page: V4Page): boolean {
  return CONTENT_URL.test(page.url ?? "");
}

/** Serialize a page function (+ optional arg) into an expression v4 can eval. */
function toExpression(
  fn: string | ((arg: unknown) => unknown),
  arg: unknown,
): string {
  if (typeof fn !== "function") return fn;
  const serializedArg = arg === undefined ? "" : JSON.stringify(arg);
  return `(${fn.toString()})(${serializedArg})`;
}

/** Parse a Playwright-style selector into a v4 locator shape. */
function parseSelector(selector: string): Loc {
  if (selector.startsWith("xpath=")) return { xpath: selector.slice(6) };
  if (selector.startsWith("/") || selector.startsWith("(")) {
    return { xpath: selector };
  }
  return { css: selector };
}

/** Expression resolving an element within a JS `document` expression. */
function resolveIn(docExpr: string, loc: Loc): string {
  if (loc.xpath) {
    return `(() => { const __d = ${docExpr}; return __d ? __d.evaluate(${JSON.stringify(
      loc.xpath,
    )}, __d, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue : null; })()`;
  }
  return `(${docExpr})?.querySelector(${JSON.stringify(loc.css ?? "")}) ?? null`;
}

/**
 * Expression for the inner `document` of a same-origin frame chain. Returns
 * `null` if any frame is missing or cross-origin (contentDocument is then null),
 * so frame reads degrade to null rather than throwing.
 */
function frameDocExpr(chain: Loc[]): string {
  let doc = "document";
  for (const frame of chain) {
    const frameEl = resolveIn(doc, frame);
    doc = `((${frameEl})?.contentDocument ?? null)`;
  }
  return doc;
}

/** Minimal V3-shaped facade over the v4 SDK, for bench tasks. */
class V4BenchStagehand {
  private readonly handles = new Map<string, V4BenchPage>();
  private activeId: string;
  readonly browserbaseSessionID: string | undefined = undefined;
  readonly browserbaseSessionURL: string | undefined = undefined;
  readonly context: {
    pages: () => V4BenchPage[];
    awaitActivePage: () => Promise<V4BenchPage>;
  };

  constructor(
    private readonly client: V4StagehandClient,
    page: V4Page,
    private readonly model: string,
    private readonly apiKey: string | undefined,
    private readonly logger: EvalLogger,
  ) {
    this.activeId = pageIdOf(page);
    this.handles.set(this.activeId, new V4BenchPage(this, page));
    this.context = {
      pages: () => [...this.handles.values()],
      awaitActivePage: async () => {
        await this.refreshPages();
        return this.activeHandle();
      },
    };
  }

  private get browser(): V4Browser {
    return this.client.browser;
  }

  private activeHandle(): V4BenchPage {
    return this.handles.get(this.activeId) ?? [...this.handles.values()][0];
  }

  /** Reconcile cached page handles + the active tab with the browser's tabs. */
  private async refreshPages(): Promise<void> {
    const pages = await this.browser.pages();
    const seen = new Set<string>();
    for (const p of pages) {
      const id = pageIdOf(p);
      // Keep tabs we already track (our working tab starts as about:blank);
      // otherwise only add real content tabs, skipping browser/extension junk.
      if (!this.handles.has(id) && !isContentTab(p)) continue;
      seen.add(id);
      const existing = this.handles.get(id);
      if (existing) existing._setPage(p);
      else this.handles.set(id, new V4BenchPage(this, p));
    }
    for (const id of [...this.handles.keys()]) {
      if (!seen.has(id)) this.handles.delete(id);
    }
    const active = await this.browser.activePage();
    if (active) {
      const id = pageIdOf(active);
      if (this.handles.has(id)) this.activeId = id;
    }
  }

  /** Retry an RPC op on v4's transient connection errors. */
  private async withRetry<T>(
    op: () => Promise<T>,
    label: string,
    attempts = 3,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await op();
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const transient = /websocket|CDP|disconnect|ECONN|socket/i.test(
          message,
        );
        if (!transient || attempt === attempts) throw error;
        this.logger.log({
          message: `v4 ${label}: transient error (attempt ${attempt}/${attempts}), retrying — ${message.slice(0, 140)}`,
          level: 0,
        });
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
    throw lastError;
  }

  private get llmOptions(): { llm_model_name: string; api_key?: string } {
    return {
      llm_model_name: this.model,
      ...(this.apiKey ? { api_key: this.apiKey } : {}),
    };
  }

  // ── per-page primitives (operate on an explicit v4 Page) ──────────────────

  /** @internal navigate a tab; goto returns a fresh Page handle. */
  async gotoOn(page: V4Page, url: string, waitUntil?: string): Promise<V4Page> {
    const next = await this.withRetry(
      () => page.goto({ url, ...(waitUntil ? { waitUntil } : {}) }),
      "goto",
    );
    await this.refreshPages();
    return next ?? page;
  }

  /** @internal evaluate a page function/expression on a tab. */
  async evaluateOn<R = unknown, Arg = unknown>(
    page: V4Page,
    fn: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    const expression = toExpression(
      fn as string | ((a: unknown) => unknown),
      arg,
    );
    const { value } = await this.withRetry(
      () =>
        page.evaluate({ expression, awaitPromise: true, returnByValue: true }),
      "evaluate",
    );
    return value as R;
  }

  /** @internal evaluate over the element a locator resolves to (frame-aware). */
  async evalForElementOn<R>(
    page: V4Page,
    loc: Loc,
    frameChain: Loc[],
    fn: (el: Element | null) => R,
  ): Promise<R> {
    const docExpr = frameChain.length ? frameDocExpr(frameChain) : "document";
    const expression = `(${fn.toString()})(${resolveIn(docExpr, loc)})`;
    const { value } = await this.withRetry(
      () =>
        page.evaluate({ expression, awaitPromise: true, returnByValue: true }),
      "evaluate",
    );
    return value as R;
  }

  /** @internal click the element a locator resolves to. */
  async locatorClickOn(
    page: V4Page,
    loc: Loc,
    frameChain: Loc[],
  ): Promise<void> {
    if (frameChain.length) {
      // v4 page.click doesn't scope to a frame; click via the DOM (same-origin).
      // Duck-type click() — cross-realm `instanceof HTMLElement` is unreliable.
      await this.evalForElementOn(page, loc, frameChain, (el): void => {
        const e = el as { click?: () => void } | null;
        if (e && typeof e.click === "function") e.click();
      });
      return;
    }
    await this.withRetry(() => page.click(loc), "click");
  }

  /** @internal resolve a locator to a v4 Locator (carries backendNodeId, etc.). */
  async locateOn(page: V4Page, loc: Loc) {
    return this.withRetry(() => page.locate(loc), "locate");
  }

  // ── v3-shaped top-level methods (default to the active tab) ────────────────

  /**
   * v3 `act`: act(instruction) | act(observeCandidate) | act(instruction, { page }).
   */
  async act(
    instructionOrAction: string | Record<string, unknown>,
    opts?: { page?: V4BenchPage; maxSteps?: number },
  ): Promise<unknown> {
    // Default to the *fresh* active tab (not the cached handle): when an act
    // opens a new tab the chain must follow the focus, e.g. multi-tab flows.
    let target: V4Page;
    if (opts?.page) {
      target = opts.page.v4page;
    } else {
      const active = await this.browser.activePage();
      target =
        active && isContentTab(active) ? active : this.activeHandle().v4page;
    }
    const params =
      typeof instructionOrAction === "string"
        ? { instruction: instructionOrAction }
        : { action: instructionOrAction };
    const result = await this.withRetry(
      () =>
        target.act({
          ...params,
          options: {
            ...this.llmOptions,
            ...(opts?.maxSteps ? { maxSteps: opts.maxSteps } : {}),
          },
        }),
      "act",
    );
    // act may open/navigate tabs; reconcile handles + active tab.
    await this.refreshPages();
    return result;
  }

  /**
   * v3 `observe` returns an array of candidates each exposing `.selector`. v4
   * returns `{ locator: { xpath, css, ... }, method, arguments, ... }`, so
   * surface `.selector` while preserving the candidate for `act(candidate)`.
   */
  async observe(instruction?: string): Promise<unknown> {
    const target = this.activeHandle().v4page;
    const res = await this.withRetry(
      () =>
        target.observe({
          ...(instruction ? { instruction } : {}),
          options: this.llmOptions,
        }),
      "observe",
    );
    const candidates = Array.isArray(res)
      ? (res as Array<Record<string, unknown>>)
      : res == null
        ? []
        : [res as Record<string, unknown>];
    return candidates.map((candidate) => {
      const loc = (candidate.locator as Loc | undefined) ?? ({} as Loc);
      return { ...candidate, selector: loc.xpath ?? loc.css ?? "" };
    });
  }

  /**
   * v3 `extract` overloads:
   *   extract(instruction)                   -> { extraction: string }
   *   extract(instruction, zodSchema, opts)  -> parsed object
   *   extract({ page })                      -> { pageText: string }  (all text)
   */
  async extract(
    arg1: string | ExtractOpts,
    arg2?: ZodType | ExtractOpts,
    arg3?: ExtractOpts,
  ): Promise<unknown> {
    // Page-text overload: extract({ page }) with no instruction.
    if (typeof arg1 !== "string") {
      const target = (arg1?.page ?? this.activeHandle()).v4page;
      const pageText = await this.evaluateOn<string>(
        target,
        () => document.body?.innerText ?? "",
      );
      return { pageText };
    }

    const isZod = arg2 != null && typeof (arg2 as ZodType).parse === "function";
    const zodSchema = isZod ? (arg2 as ZodType) : undefined;
    const opts = (isZod ? arg3 : (arg2 as ExtractOpts)) ?? {};
    const target = (opts.page ?? this.activeHandle()).v4page;

    // No-schema v3 extract resolves to { extraction: string }; ask v4 for that
    // exact shape so the task's `const { extraction } = ...` keeps working.
    const jsonSchema: Record<string, unknown> = zodSchema
      ? (z.toJSONSchema(zodSchema) as Record<string, unknown>)
      : {
          type: "object",
          properties: { extraction: { type: "string" } },
          required: ["extraction"],
        };

    const raw = await this.withRetry(
      () =>
        target.extract({
          instruction: arg1,
          schema: jsonSchema,
          ...(opts.selector ? { locator: { xpath: opts.selector } } : {}),
          options: this.llmOptions,
        }),
      "extract",
    );

    if (!zodSchema) return raw;

    const parsed = zodSchema.safeParse(raw);
    if (parsed.success) return parsed.data;
    this.logger.log({
      message: `v4 extract result did not match schema: ${parsed.error.message}; raw=${JSON.stringify(
        raw,
      ).slice(0, 400)}`,
      level: 0,
    });
    return raw;
  }

  async close(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      // best-effort
    }
  }
}

class V4BenchPage {
  constructor(
    private readonly sdk: V4BenchStagehand,
    private page: V4Page,
  ) {}

  /** @internal */ _setPage(page: V4Page): void {
    this.page = page;
  }
  get v4page(): V4Page {
    return this.page;
  }

  async goto(url: string, opts?: { waitUntil?: string }): Promise<void> {
    this.page = await this.sdk.gotoOn(this.page, url, opts?.waitUntil);
  }

  url(): string {
    return this.page.url ?? "";
  }

  async evaluate<R = unknown, Arg = unknown>(
    fn: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    return this.sdk.evaluateOn<R, Arg>(this.page, fn, arg);
  }

  locator(selector: string): V4BenchLocator {
    return new V4BenchLocator(this.sdk, this.page, parseSelector(selector), []);
  }

  /** Same-origin iframe support (cross-origin/OOPIF frames resolve to null). */
  frameLocator(selector: string): V4BenchFrameLocator {
    return new V4BenchFrameLocator(this.sdk, this.page, [
      parseSelector(selector),
    ]);
  }

  /**
   * v3 `page.frames()` → [mainFrame, ...iframes in DOM order]. We can't count
   * frames synchronously, so return index-addressable handles (main = 0, the
   * i-th iframe = i); resolution happens lazily at `.evaluate()` (same-origin).
   */
  frames(): V4BenchFrame[] {
    return Array.from(
      { length: 8 },
      (_unused, i) => new V4BenchFrame(this.sdk, this.page, i),
    );
  }
}

/**
 * A Playwright-Frame-shaped handle for same-origin frames. `index` 0 is the main
 * frame; `index` N (>0) is the (N-1)-th `<iframe>` in the top document. For sub
 * frames, `evaluate(fn)` runs `fn` with `window`/`document` shadowed by the
 * iframe's `contentWindow`/`contentDocument` (cross-origin frames throw/return null).
 */
class V4BenchFrame {
  constructor(
    private readonly sdk: V4BenchStagehand,
    private readonly page: V4Page,
    private readonly index: number,
  ) {}

  async evaluate<R = unknown, Arg = unknown>(
    fn: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    if (this.index === 0)
      return this.sdk.evaluateOn<R, Arg>(this.page, fn, arg);
    const body = toExpression(fn as string | ((a: unknown) => unknown), arg);
    // Use globalThis.document for the lookup BEFORE shadowing `document` below —
    // referencing the bare `document` here would hit the const's temporal dead zone.
    const expr = `(function () {
      const __f = globalThis.document.querySelectorAll("iframe")[${this.index - 1}];
      if (!__f || !__f.contentWindow) return null;
      const window = __f.contentWindow;
      const document = __f.contentDocument;
      return ${body};
    })()`;
    return this.sdk.evaluateOn<R>(this.page, expr);
  }
}

/** A frame-scoped locator factory (supports nesting via `.frameLocator`). */
class V4BenchFrameLocator {
  constructor(
    private readonly sdk: V4BenchStagehand,
    private readonly page: V4Page,
    private readonly chain: Loc[],
  ) {}

  frameLocator(selector: string): V4BenchFrameLocator {
    return new V4BenchFrameLocator(this.sdk, this.page, [
      ...this.chain,
      parseSelector(selector),
    ]);
  }

  locator(selector: string): V4BenchLocator {
    return new V4BenchLocator(
      this.sdk,
      this.page,
      parseSelector(selector),
      this.chain,
    );
  }
}

/** Minimal Playwright-Locator-shaped handle over a v4 element. */
class V4BenchLocator {
  constructor(
    private readonly sdk: V4BenchStagehand,
    private readonly page: V4Page,
    private readonly loc: Loc,
    private readonly frameChain: Loc[],
  ) {}

  first(): V4BenchLocator {
    return this;
  }

  async click(): Promise<void> {
    await this.sdk.locatorClickOn(this.page, this.loc, this.frameChain);
  }

  async textContent(): Promise<string | null> {
    return this.sdk.evalForElementOn(
      this.page,
      this.loc,
      this.frameChain,
      (el) => el?.textContent ?? null,
    );
  }

  // NOTE: these read fns run in the page and may target elements inside an
  // iframe, whose realm differs from the top window — so `instanceof
  // HTMLInputElement` is false there. Duck-type via property access instead.

  async innerText(): Promise<string> {
    return this.sdk.evalForElementOn(
      this.page,
      this.loc,
      this.frameChain,
      (el) => {
        const e = el as { innerText?: unknown } | null;
        return e && typeof e.innerText === "string" ? e.innerText : "";
      },
    );
  }

  async innerHtml(): Promise<string> {
    return this.sdk.evalForElementOn(
      this.page,
      this.loc,
      this.frameChain,
      (el) => {
        const e = el as { innerHTML?: unknown } | null;
        return e && typeof e.innerHTML === "string" ? e.innerHTML : "";
      },
    );
  }

  async inputValue(): Promise<string> {
    return this.sdk.evalForElementOn(
      this.page,
      this.loc,
      this.frameChain,
      (el) => {
        const e = el as { value?: unknown } | null;
        return e && typeof e.value === "string" ? e.value : "";
      },
    );
  }

  async isVisible(): Promise<boolean> {
    return this.sdk.evalForElementOn(
      this.page,
      this.loc,
      this.frameChain,
      (el) => {
        const e = el as { getClientRects?: () => { length: number } } | null;
        return !!(e && e.getClientRects && e.getClientRects().length > 0);
      },
    );
  }

  async isChecked(): Promise<boolean> {
    return this.sdk.evalForElementOn(
      this.page,
      this.loc,
      this.frameChain,
      (el) => {
        const e = el as { checked?: unknown } | null;
        return !!(e && e.checked);
      },
    );
  }

  /** CDP backend node id — used by observe tasks to compare element identity. */
  async backendNodeId(): Promise<number | undefined> {
    const resolved = await this.sdk.locateOn(this.page, this.loc);
    return resolved.backendNodeId;
  }
}

export async function initV4Bench(args: {
  logger: EvalLogger;
  modelName: AvailableModel;
  environment?: "LOCAL" | "BROWSERBASE";
}): Promise<V3InitResult> {
  if (args.environment === "BROWSERBASE") {
    throw new Error("EVAL_SDK=v4 (bench PoC) currently supports LOCAL only.");
  }

  const model = String(args.modelName);
  if (!model.includes("/")) {
    throw new Error(
      `EVAL_SDK=v4 needs a provider-prefixed model (e.g. "anthropic/claude-sonnet-4-6"); got "${model}".`,
    );
  }
  const provider = model.split("/")[0];
  const apiKey =
    loadApiKeyFromEnv(provider, args.logger.log.bind(args.logger)) ?? undefined;

  await tolerateDuplicateZodIds();
  const { StagehandClient } = await import(
    "../core/tools/vendor/stagehand-v4.js"
  );
  const client = new StagehandClient({});
  await client.connect();

  // Hydrate the model + provider key into the extension (mirrors run-v4.ts).
  const keyOption = PROVIDER_KEY_OPTION[provider];
  await (
    client as unknown as {
      Stagehand: { ExtensionUISetOptions: (a: unknown) => Promise<unknown> };
    }
  ).Stagehand.ExtensionUISetOptions({
    options: {
      llm_model_name: model,
      ...(keyOption && apiKey ? { [keyOption]: apiKey } : {}),
    },
  });

  const browser = client.browser as V4Browser;
  const page = await browser.newPage({});
  const v3 = new V4BenchStagehand(client, page, model, apiKey, args.logger);

  return {
    v3: v3 as unknown as V3InitResult["v3"],
    logger: args.logger,
    debugUrl: "",
    sessionUrl: "",
    modelName: args.modelName,
    agent: undefined,
  };
}
