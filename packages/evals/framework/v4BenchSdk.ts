/**
 * Proof-of-concept: run bench `extract` tasks against the Stagehand **v4** SDK,
 * single model. Provides a minimal `V3`-shaped facade exposing only the surface
 * extract tasks + the bench harness actually touch
 * (`context.pages()[0].goto`, `extract(instruction, schema, { selector })`,
 * `close()`), backed by the vendored v4 client.
 *
 * Enabled via `EVAL_SDK=v4` in benchHarness; scoped to the extract category.
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

interface ExtractOpts {
  selector?: string;
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
function parseSelector(selector: string): { css?: string; xpath?: string } {
  if (selector.startsWith("xpath=")) return { xpath: selector.slice(6) };
  if (selector.startsWith("/") || selector.startsWith("(")) {
    return { xpath: selector };
  }
  return { css: selector };
}

/** Expression resolving the single element a locator points at (CSS or XPath). */
function elementExpression(loc: { css?: string; xpath?: string }): string {
  if (loc.xpath) {
    return `document.evaluate(${JSON.stringify(loc.xpath)}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`;
  }
  return `document.querySelector(${JSON.stringify(loc.css ?? "")})`;
}

/** Minimal V3-shaped facade over a v4 page, for bench extract tasks. */
class V4BenchStagehand {
  private current: V4Page;
  readonly browserbaseSessionID: string | undefined = undefined;
  readonly browserbaseSessionURL: string | undefined = undefined;
  readonly context: { pages: () => V4BenchPage[] };

  constructor(
    private readonly client: V4StagehandClient,
    page: V4Page,
    private readonly model: string,
    private readonly apiKey: string | undefined,
    private readonly logger: EvalLogger,
  ) {
    this.current = page;
    const pageFacade = new V4BenchPage(this);
    this.context = { pages: () => [pageFacade] };
  }

  /**
   * Retry an RPC op on v4's transient connection errors. The "CDP websocket
   * closed" failures originate browser-side in the extension's CDP layer, so a
   * fresh command often re-attaches.
   */
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

  /** @internal navigate the active tab (goto returns a fresh Page handle). */
  async navigate(url: string, waitUntil?: string): Promise<void> {
    const next = await this.withRetry(
      () => this.current.goto({ url, ...(waitUntil ? { waitUntil } : {}) }),
      "goto",
    );
    if (next) this.current = next;
  }

  /**
   * v3 `act` overloads: act(instruction) | act(observeResult) | act(instruction, opts).
   * Bench act tasks overwhelmingly pass a plain instruction string.
   */
  async act(
    instructionOrAction: string | Record<string, unknown>,
    opts?: { maxSteps?: number },
  ): Promise<unknown> {
    const params =
      typeof instructionOrAction === "string"
        ? { instruction: instructionOrAction }
        : { action: instructionOrAction };
    const result = await this.withRetry(
      () =>
        this.current.act({
          ...params,
          options: {
            ...this.llmOptions,
            ...(opts?.maxSteps ? { maxSteps: opts.maxSteps } : {}),
          },
        }),
      "act",
    );
    // act may navigate/mutate the tab; refresh so url()/evaluate see the result.
    const active = await this.client.browser.activePage();
    if (active) this.current = active;
    return result;
  }

  /**
   * v3 `observe` returns an array of candidates each exposing `.selector` (an
   * xpath). v4 returns an array of `{ locator: { xpath, css, ... }, method,
   * arguments, ... }`, so surface `.selector` from the nested locator while
   * preserving the full candidate (so `act(candidate)` round-trips into v4).
   */
  async observe(instruction?: string): Promise<unknown> {
    const res = await this.withRetry(
      () =>
        this.current.observe({
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
      const loc =
        (candidate.locator as { xpath?: string; css?: string } | undefined) ??
        {};
      return { ...candidate, selector: loc.xpath ?? loc.css ?? "" };
    });
  }

  /**
   * v3 `extract` overloads handled here:
   *   extract(instruction)                      -> { extraction: string }
   *   extract(instruction, zodSchema, opts?)    -> parsed object
   */
  async extract(
    instruction: string,
    schemaOrOpts?: ZodType | ExtractOpts,
    maybeOpts?: ExtractOpts,
  ): Promise<unknown> {
    const isZod =
      schemaOrOpts != null &&
      typeof (schemaOrOpts as ZodType).parse === "function";
    const zodSchema = isZod ? (schemaOrOpts as ZodType) : undefined;
    const opts = (isZod ? maybeOpts : (schemaOrOpts as ExtractOpts)) ?? {};

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
        this.current.extract({
          instruction,
          schema: jsonSchema,
          ...(opts.selector ? { locator: { xpath: opts.selector } } : {}),
          options: this.llmOptions,
        }),
      "extract",
    );

    if (!zodSchema) return raw;

    const parsed = zodSchema.safeParse(raw);
    if (parsed.success) return parsed.data;

    // Surface the mismatch but hand back the raw object so the task can still
    // make its own comparison (a shape delta is a finding, not a crash).
    this.logger.log({
      message: `v4 extract result did not match schema: ${parsed.error.message}; raw=${JSON.stringify(
        raw,
      ).slice(0, 400)}`,
      level: 0,
    });
    return raw;
  }

  /** @internal current URL of the active tab (sync; refreshed after nav/act). */
  currentUrl(): string {
    return this.current.url ?? "";
  }

  /** @internal evaluate a page function/expression on the active tab. */
  async evaluate<R = unknown, Arg = unknown>(
    fn: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    const expression = toExpression(
      fn as string | ((a: unknown) => unknown),
      arg,
    );
    const { value } = await this.withRetry(
      () =>
        this.current.evaluate({
          expression,
          awaitPromise: true,
          returnByValue: true,
        }),
      "evaluate",
    );
    return value as R;
  }

  /** @internal evaluate a function over the element a locator resolves to. */
  async evalForElement<R>(
    loc: { css?: string; xpath?: string },
    fn: (el: Element | null) => R,
  ): Promise<R> {
    const expression = `(${fn.toString()})(${elementExpression(loc)})`;
    const { value } = await this.withRetry(
      () =>
        this.current.evaluate({
          expression,
          awaitPromise: true,
          returnByValue: true,
        }),
      "evaluate",
    );
    return value as R;
  }

  /** @internal click the element a locator resolves to. */
  async locatorClick(loc: { css?: string; xpath?: string }): Promise<void> {
    await this.withRetry(() => this.current.click(loc), "click");
  }

  /** @internal resolve a locator to a v4 Locator (carries backendNodeId, etc.). */
  async locate(loc: { css?: string; xpath?: string }) {
    return this.withRetry(() => this.current.locate(loc), "locate");
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
  constructor(private readonly sdk: V4BenchStagehand) {}

  async goto(url: string, opts?: { waitUntil?: string }): Promise<void> {
    await this.sdk.navigate(url, opts?.waitUntil);
  }

  url(): string {
    return this.sdk.currentUrl();
  }

  async evaluate<R = unknown, Arg = unknown>(
    fn: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    return this.sdk.evaluate<R, Arg>(fn, arg);
  }

  locator(selector: string): V4BenchLocator {
    return new V4BenchLocator(this.sdk, parseSelector(selector));
  }

  frameLocator(): never {
    throw new Error(
      "page.frameLocator() is not supported by the v4 bench facade yet (iframe tasks).",
    );
  }

  frames(): never {
    throw new Error(
      "page.frames() is not supported by the v4 bench facade yet (iframe tasks).",
    );
  }
}

/** Minimal Playwright-Locator-shaped handle over a v4 element, for act tasks. */
class V4BenchLocator {
  constructor(
    private readonly sdk: V4BenchStagehand,
    private readonly loc: { css?: string; xpath?: string },
  ) {}

  /** v3 `locator(...).first()` — we already resolve the first match, so identity. */
  first(): V4BenchLocator {
    return this;
  }

  async click(): Promise<void> {
    await this.sdk.locatorClick(this.loc);
  }

  async textContent(): Promise<string | null> {
    return this.sdk.evalForElement(this.loc, (el) => el?.textContent ?? null);
  }

  async innerText(): Promise<string> {
    return this.sdk.evalForElement(this.loc, (el) =>
      el instanceof HTMLElement ? el.innerText : "",
    );
  }

  /** CDP backend node id — used by observe tasks to compare element identity. */
  async backendNodeId(): Promise<number | undefined> {
    const resolved = await this.sdk.locate(this.loc);
    return resolved.backendNodeId;
  }

  async inputValue(): Promise<string> {
    return this.sdk.evalForElement(this.loc, (el) =>
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
        ? el.value
        : "",
    );
  }

  async isVisible(): Promise<boolean> {
    return this.sdk.evalForElement(
      this.loc,
      (el) => el != null && (el as HTMLElement).getClientRects().length > 0,
    );
  }

  async isChecked(): Promise<boolean> {
    return this.sdk.evalForElement(this.loc, (el) =>
      el instanceof HTMLInputElement ? el.checked : false,
    );
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
