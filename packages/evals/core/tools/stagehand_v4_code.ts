/**
 * CORE tool surface backed by the Stagehand **v4** JS SDK (`stagehand-v4`).
 *
 * This is the v4 analogue of `understudy_code.ts`: it implements the same
 * tool-agnostic contracts (`CoreTool` / `CoreSession` / `CorePageHandle` /
 * `CoreLocatorHandle`) so the existing CORE tasks run unchanged via
 * `evals run core --tool stagehand_v4_code`.
 *
 * v4 is a client/server SDK whose Page/Browser methods are RPC calls, so a few
 * deterministic capabilities that v4 has no dedicated method for
 * (`title`, `waitForSelector`, locator `count`/`isVisible`/`textContent`/
 * `inputValue`) are polyfilled here via `page.evaluate`.
 *
 * The `StagehandClient` import resolves to a pre-bundled copy of the TS-only v4
 * SDK — see `vendor/stagehand-v4.d.ts` and `scripts/build-v4-shim.ts`.
 */
import type {
  StagehandClient as V4StagehandClient,
  V4Browser,
  V4Page,
} from "./vendor/stagehand-v4.js";
import type {
  CoreCapability,
  CoreLocatorHandle,
  CorePageHandle,
  CoreSession,
  CoreTool,
  NavOpts,
  StartupProfile,
  ToolStartInput,
  ToolStartResult,
} from "../contracts/tool.js";
import type {
  ActionTarget,
  TargetKind,
  WaitSpec,
} from "../contracts/targets.js";
import type {
  PageRepresentation,
  RepresentationOpts,
} from "../contracts/representation.js";
import type { Artifact, ConnectionMode } from "../contracts/results.js";

const SUPPORTED_CAPABILITIES: CoreCapability[] = [
  "session",
  "navigation",
  "evaluation",
  "screenshot",
  "viewport",
  "wait",
  "click",
  "hover",
  "scroll",
  "type",
  "press",
  "tabs",
  "representation",
];

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

interface ZodRegistryLike {
  _idmap: Map<string, unknown>;
  add: (schema: unknown, ...meta: unknown[]) => unknown;
  __shLenientIds?: boolean;
}

/**
 * The v3 and v4 SDKs both register zod `.meta({ id })` schemas into zod's
 * process-global registry (`globalThis.__zod_globalRegistry`), and their ids
 * overlap (e.g. "ActResult"). Because the evals framework pulls in the v3 SDK
 * (logger/context types, MCP tools) before this surface loads v4, v4's
 * registration would throw "ID ... already exists in the registry".
 *
 * Make duplicate-id registration a no-op so both SDKs coexist in one process.
 * This only affects the global-registry id map (used for JSON-schema export /
 * introspection); runtime `.parse()` validation operates on the schema objects
 * directly and is unaffected. Idempotent and applied lazily, only when this
 * surface actually starts.
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
      return globalRegistry; // already claimed (by the other SDK) — skip
    }
    return original(schema, ...meta);
  };
  globalRegistry.__shLenientIds = true;
}

function pageIdOf(page: V4Page): string {
  return String(page.targetId ?? page.tabId ?? page.page_idx ?? "");
}

/** Serialize a page function (+ optional arg) into an expression v4 can eval. */
function toExpression(
  pageFunctionOrExpression: string | ((arg: unknown) => unknown),
  arg: unknown,
): string {
  if (typeof pageFunctionOrExpression !== "function") {
    return pageFunctionOrExpression;
  }
  const serializedArg = arg === undefined ? "" : JSON.stringify(arg);
  return `(${pageFunctionOrExpression.toString()})(${serializedArg})`;
}

class V4LocatorHandle implements CoreLocatorHandle {
  constructor(
    private readonly page: V4Page,
    private readonly selector: string,
  ) {}

  private async evalForElement<R>(fn: (el: Element | null) => R): Promise<R> {
    const expression = `(${fn.toString()})(document.querySelector(${JSON.stringify(
      this.selector,
    )}))`;
    const { value } = await this.page.evaluate({
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return value as R;
  }

  async count(): Promise<number> {
    const expression = `document.querySelectorAll(${JSON.stringify(
      this.selector,
    )}).length`;
    const { value } = await this.page.evaluate({
      expression,
      returnByValue: true,
    });
    return Number(value) || 0;
  }

  async click(): Promise<void> {
    await this.page.click({ css: this.selector });
  }

  async hover(): Promise<void> {
    await this.page.hover({ css: this.selector });
  }

  async fill(value: string): Promise<void> {
    await this.page.type({ css: this.selector, text: value });
  }

  async type(text: string): Promise<void> {
    await this.page.type({ css: this.selector, text });
  }

  async isVisible(): Promise<boolean> {
    return this.evalForElement(
      (el) => el != null && (el as HTMLElement).getClientRects().length > 0,
    );
  }

  async textContent(): Promise<string | null> {
    return this.evalForElement((el) => el?.textContent ?? null);
  }

  async inputValue(): Promise<string> {
    return this.evalForElement((el) =>
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement
        ? el.value
        : "",
    );
  }
}

class V4PageHandle implements CorePageHandle {
  readonly id: string;

  constructor(
    private page: V4Page,
    private readonly browser: V4Browser,
  ) {
    this.id = pageIdOf(page);
  }

  /** Re-point this handle at its v4 Page (the session updates it after nav). */
  _adopt(page: V4Page): void {
    this.page = page;
  }

  /** v4 nav methods that don't return a Page leave `url` stale; refresh it. */
  private async refreshActive(): Promise<void> {
    const active = await this.browser.activePage();
    if (active && pageIdOf(active) === this.id) {
      this.page = active;
    }
  }

  async goto(url: string, opts?: NavOpts): Promise<void> {
    this.page = await this.page.goto({
      url,
      ...(opts?.waitUntil ? { waitUntil: opts.waitUntil } : {}),
    });
  }

  async reload(opts?: NavOpts): Promise<void> {
    await this.page.reload(
      opts?.waitUntil ? { waitUntil: opts.waitUntil } : {},
    );
    await this.refreshActive();
  }

  async back(): Promise<boolean> {
    await this.page.goBack();
    await this.refreshActive();
    return true;
  }

  async forward(): Promise<boolean> {
    await this.page.goForward();
    await this.refreshActive();
    return true;
  }

  async goBack(): Promise<boolean> {
    return this.back();
  }

  async goForward(): Promise<boolean> {
    return this.forward();
  }

  url(): string {
    return this.page.url ?? "";
  }

  async title(): Promise<string> {
    return (await this.evaluate<string>("document.title")) ?? "";
  }

  async evaluate<R = unknown, Arg = unknown>(
    pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    const expression = toExpression(
      pageFunctionOrExpression as string | ((arg: unknown) => unknown),
      arg,
    );
    const { value } = await this.page.evaluate({
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    return value as R;
  }

  async screenshot(): Promise<Buffer> {
    const { screenshot } = await this.page.screenshot();
    return Buffer.from(screenshot ?? "", "base64");
  }

  async setViewport(size: { width: number; height: number }): Promise<void> {
    await this.browser.setViewport({ width: size.width, height: size.height });
  }

  async setViewportSize(width: number, height: number): Promise<void> {
    await this.browser.setViewport({ width, height });
  }

  async wait(spec: WaitSpec): Promise<void> {
    switch (spec.kind) {
      case "selector":
        await this.waitForSelector(spec.selector, {
          timeout: spec.timeoutMs,
          state: spec.state,
        });
        return;
      case "timeout":
        await delay(spec.timeoutMs);
        return;
      case "load_state":
        // v4 has no waitForLoadState; goto/reload already settle the page.
        await delay(Math.min(spec.timeoutMs ?? 250, 2000));
        return;
      default: {
        const exhaustive: never = spec;
        throw new Error(`Unsupported wait spec: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  async waitForSelector(
    selector: string,
    opts?: {
      timeout?: number;
      state?: "attached" | "detached" | "visible" | "hidden";
    },
  ): Promise<boolean> {
    const state = opts?.state ?? "visible";
    const timeout = opts?.timeout ?? 30_000;
    const deadline = Date.now() + timeout;

    for (;;) {
      const ok = await this.evaluate<
        boolean,
        { selector: string; state: string }
      >(
        (args) => {
          const el = document.querySelector(args.selector);
          const present = el != null;
          const visible =
            present && (el as HTMLElement).getClientRects().length > 0;
          switch (args.state) {
            case "attached":
              return present;
            case "detached":
              return !present;
            case "hidden":
              return !visible;
            default:
              return visible;
          }
        },
        { selector, state },
      );

      if (ok) return true;
      if (Date.now() >= deadline) {
        if (state === "visible" || state === "attached") {
          throw new Error(
            `waitForSelector("${selector}", state=${state}) timed out after ${timeout}ms`,
          );
        }
        return false;
      }
      await delay(50);
    }
  }

  async waitForTimeout(ms: number): Promise<void> {
    await delay(ms);
  }

  locator(selector: string): CoreLocatorHandle {
    return new V4LocatorHandle(this.page, selector);
  }

  async click(
    targetOrX: string | ActionTarget | number,
    y?: number,
  ): Promise<void> {
    if (typeof targetOrX === "number") {
      if (typeof y !== "number") {
        throw new Error("click(x, y) requires both numeric coordinates");
      }
      await this.page.click({ coordinates: { x: targetOrX, y } });
      return;
    }

    const target =
      typeof targetOrX === "string"
        ? ({ kind: "selector", value: targetOrX } as const)
        : targetOrX;

    switch (target.kind) {
      case "selector":
        await this.page.click({ css: target.value });
        return;
      case "coords":
        await this.page.click({ coordinates: { x: target.x, y: target.y } });
        return;
      default:
        throw new Error(
          `stagehand_v4_code does not support click target kind "${target.kind}" yet`,
        );
    }
  }

  async hover(
    targetOrX: string | ActionTarget | number,
    y?: number,
  ): Promise<void> {
    if (typeof targetOrX === "number") {
      if (typeof y !== "number") {
        throw new Error("hover(x, y) requires both numeric coordinates");
      }
      await this.page.hover({ coordinates: { x: targetOrX, y } });
      return;
    }

    const target =
      typeof targetOrX === "string"
        ? ({ kind: "selector", value: targetOrX } as const)
        : targetOrX;

    switch (target.kind) {
      case "selector":
        await this.page.hover({ css: target.value });
        return;
      case "coords":
        await this.page.hover({ coordinates: { x: target.x, y: target.y } });
        return;
      default:
        throw new Error(
          `stagehand_v4_code does not support hover target kind "${target.kind}" yet`,
        );
    }
  }

  async scroll(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
  ): Promise<void> {
    await this.page.scroll({ coordinates: { x, y }, deltaX, deltaY });
  }

  async type(
    targetOrText: string | ActionTarget | { kind: "focused" },
    text?: string,
  ): Promise<void> {
    if (typeof targetOrText === "string" && typeof text === "undefined") {
      await this.page.type({ text: targetOrText });
      return;
    }

    if (typeof text !== "string") {
      throw new Error("type(target, text) requires text");
    }

    const target =
      typeof targetOrText === "string"
        ? ({ kind: "selector", value: targetOrText } as const)
        : targetOrText;

    switch (target.kind) {
      case "focused":
        await this.page.type({ text });
        return;
      case "selector":
        await this.page.type({ css: target.value, text });
        return;
      case "coords":
        await this.page.click({ coordinates: { x: target.x, y: target.y } });
        await this.page.type({ text });
        return;
      default:
        throw new Error(
          `stagehand_v4_code does not support type target kind "${target.kind}" yet`,
        );
    }
  }

  async press(
    targetOrKey: string | ActionTarget | { kind: "focused" },
    key?: string,
  ): Promise<void> {
    if (typeof targetOrKey === "string" && typeof key === "undefined") {
      await this.page.keyPress({ key: targetOrKey });
      return;
    }

    if (typeof key !== "string") {
      throw new Error("press(target, key) requires key");
    }

    const target =
      typeof targetOrKey === "string"
        ? ({ kind: "selector", value: targetOrKey } as const)
        : targetOrKey;

    switch (target.kind) {
      case "focused":
        await this.page.keyPress({ key });
        return;
      case "selector":
        await this.page.click({ css: target.value });
        await this.page.keyPress({ key });
        return;
      case "coords":
        await this.page.click({ coordinates: { x: target.x, y: target.y } });
        await this.page.keyPress({ key });
        return;
      default:
        throw new Error(
          `stagehand_v4_code does not support press target kind "${target.kind}" yet`,
        );
    }
  }

  async represent(opts?: RepresentationOpts): Promise<PageRepresentation> {
    const snapshot = await this.page.snapshot(
      opts?.includeIframes != null
        ? { includeIframes: opts.includeIframes }
        : {},
    );
    const content = snapshot.formattedTree ?? "";

    return {
      kind: "snapshot_refs",
      content,
      metadata: {
        bytes: Buffer.byteLength(content, "utf8"),
        tokenEstimate: Math.ceil(content.length / 4),
        refCount: Object.keys(snapshot.xpathMap ?? {}).length,
      },
      raw: snapshot,
    };
  }
}

class V4Session implements CoreSession {
  private readonly handles = new Map<string, V4PageHandle>();
  private closed = false;

  constructor(private readonly client: V4StagehandClient) {}

  private get browser(): V4Browser {
    return this.client.browser;
  }

  private wrap(page: V4Page): V4PageHandle {
    const id = pageIdOf(page);
    const existing = this.handles.get(id);
    if (existing) {
      existing._adopt(page);
      return existing;
    }
    const handle = new V4PageHandle(page, this.browser);
    this.handles.set(id, handle);
    return handle;
  }

  async listPages(): Promise<CorePageHandle[]> {
    const pages = await this.browser.pages();
    return pages.map((page) => this.wrap(page));
  }

  async activePage(): Promise<CorePageHandle> {
    const active = await this.browser.activePage();
    const page = active ?? (await this.browser.pages())[0];
    if (!page) {
      throw new Error("No active page available");
    }
    return this.wrap(page);
  }

  async newPage(url?: string): Promise<CorePageHandle> {
    const page = await this.browser.newPage(url ? { url } : {});
    return this.wrap(page);
  }

  async selectPage(pageId: string): Promise<void> {
    const pages = await this.browser.pages();
    const target = pages.find((page) => pageIdOf(page) === pageId);
    if (!target) {
      throw new Error(`Unknown page id "${pageId}"`);
    }
    await target.bringToFront();
    this.wrap(target);
  }

  async closePage(pageId: string): Promise<void> {
    const pages = await this.browser.pages();
    const target = pages.find((page) => pageIdOf(page) === pageId);
    if (!target) {
      throw new Error(`Unknown page id "${pageId}"`);
    }
    await target.close();
    this.handles.delete(pageId);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.client.close();
    } catch {
      // best-effort
    }
  }

  async getArtifacts(): Promise<Artifact[]> {
    return [];
  }

  async getRawMetrics(): Promise<Record<string, unknown>> {
    return {};
  }
}

export class StagehandV4CodeTool implements CoreTool {
  readonly id = "stagehand_v4_code";
  readonly surface = "code";
  readonly family = "stagehand_v4";
  readonly supportedStartupProfiles: StartupProfile[] = [
    "tool_launch_local",
    "runner_provided_local_cdp",
  ];
  readonly supportedCapabilities: CoreCapability[] = [
    ...SUPPORTED_CAPABILITIES,
  ];
  readonly supportedTargetKinds: TargetKind[] = [
    "selector",
    "coords",
    "focused",
  ];

  async start(input: ToolStartInput): Promise<ToolStartResult> {
    if (input.environment === "BROWSERBASE") {
      throw new Error(
        "stagehand_v4_code does not support the BROWSERBASE environment yet",
      );
    }

    // Let v4's zod schema ids coexist with v3's already-registered ones, then
    // load the (side-effectful, multi-MB) v4 SDK lazily — only when this
    // surface is actually used, not whenever the tool registry is imported.
    // The browser extension it loads at connect() is supplied out-of-band by
    // build:v4shim, which drops the version-matched zip next to the CLI bundle
    // (the SDK resolves it relative to its own runtime dir).
    await tolerateDuplicateZodIds();
    const { StagehandClient } = await import("./vendor/stagehand-v4.js");

    // tool_launch_local → v4 launches its own Chrome + extension.
    // runner_provided_local_cdp → attach to the CDP endpoint the runner launched.
    const client = new StagehandClient(
      input.providedEndpoint?.url
        ? { cdp_url: input.providedEndpoint.url }
        : {},
    );
    await client.connect();

    const session = new V4Session(client);
    const connectionMode: ConnectionMode = input.providedEndpoint
      ? input.providedEndpoint.kind === "http"
        ? "attach_http"
        : "attach_ws"
      : "launch";

    return {
      session,
      cleanup: async () => {
        await session.close();
      },
      metadata: {
        environment: "local",
        browserOwnership: input.providedEndpoint ? "runner" : "tool",
        connectionMode,
        startupProfile: input.startupProfile,
      },
    };
  }
}
