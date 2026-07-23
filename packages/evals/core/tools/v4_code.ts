/**
 * v4_code — the "v4 code mode" tool surface.
 *
 * The v4 analogue of understudy_code: a CoreTool whose session is backed by
 * the Stagehand v4 SDK (initV4), so harnesses can drive the browser by
 * writing code against v4's Page/Locator/Stagehand surface.
 *
 * Capability map vs the contract (all gaps are v4 SDK realities, not
 * omissions here):
 * - coords targets: UNSUPPORTED — v4 is DOM-only; no click(x, y) primitive.
 * - viewport: UNSUPPORTED — no viewport API on the v4 Page.
 * - url(): the contract is sync but every v4 accessor is an async RPC
 *   (V4_API_LOGS #9). We track the last URL observed by this handle
 *   (updated on nav calls and waits); it can lag in-page navigations.
 * - scroll: page-level wheel scrolling is emulated via evaluate()
 *   (window.scrollBy) in the main frame.
 * - type/press on "focused": routed through page.keyPress.
 */
import { z } from "zod/v4";
import type {
  Page as V4Page,
  Locator as V4Locator,
  Stagehand as V4Stagehand,
} from "@browserbasehq/stagehand-v4-spike-sdk-ts";
import { EvalsError } from "../../errors.js";
import { initV4, type V4InitResult } from "../../initV4.js";
import type { EvalLogger } from "../../logger.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import type {
  ActionTarget,
  FocusedTarget,
  TargetKind,
  WaitSpec,
} from "../contracts/targets.js";
import {
  LLM_RUN_TOOL_NAME,
  type LLMExposure,
  type CoreCapability,
  type CoreLocatorHandle,
  type CorePageHandle,
  type CoreSession,
  type CoreTool,
  type NavOpts,
  type ScreenshotOpts,
  type StartupProfile,
  type ToolStartInput,
  type ToolStartResult,
} from "../contracts/tool.js";
import type { Artifact } from "../contracts/results.js";

const SUPPORTED_CAPABILITIES: CoreCapability[] = [
  "session",
  "navigation",
  "evaluation",
  "screenshot",
  "wait",
  "click",
  "hover",
  "scroll",
  "type",
  "press",
  "tabs",
];

/** The tool's internal SDK model (parity with understudy_code's fixed
 * model); the benchmark's model drives the harness, not this surface. */
const SURFACE_MODEL = "openai/gpt-4.1-mini";

class V4LocatorHandle implements CoreLocatorHandle {
  constructor(private readonly locator: V4Locator) {}

  count(): Promise<number> {
    return this.locator.count();
  }
  click(): Promise<void> {
    return this.locator.click();
  }
  hover(): Promise<void> {
    return this.locator.hover();
  }
  fill(value: string): Promise<void> {
    return this.locator.fill(value);
  }
  async type(text: string, opts?: { delay?: number }): Promise<void> {
    await this.locator.type(
      text,
      opts?.delay ? { delay: opts.delay } : undefined,
    );
  }
  isVisible(): Promise<boolean> {
    return this.locator.isVisible();
  }
  textContent(): Promise<string | null> {
    return this.locator.textContent();
  }
  inputValue(): Promise<string> {
    return this.locator.inputValue();
  }
}

function targetSelector(target: string | ActionTarget): string {
  if (typeof target === "string") return target;
  if (target.kind === "selector") return target.value;
  throw new Error(
    `v4_code supports selector targets only (v4 is DOM-only); got kind "${target.kind}"`,
  );
}

class V4PageHandle implements CorePageHandle {
  readonly id: string;
  private lastUrl = "about:blank";

  constructor(
    private readonly page: V4Page,
    id: string,
  ) {
    this.id = id;
  }

  private async refreshUrl(): Promise<void> {
    this.lastUrl = await this.page.url();
  }

  async goto(url: string, opts?: NavOpts): Promise<void> {
    await this.page.goto(url, {
      ...(opts?.waitUntil ? { waitUntil: opts.waitUntil } : {}),
      ...(opts?.timeoutMs ? { timeout: opts.timeoutMs } : {}),
    });
    await this.refreshUrl();
  }
  async reload(opts?: NavOpts): Promise<void> {
    await this.page.reload(
      opts?.waitUntil ? { waitUntil: opts.waitUntil } : undefined,
    );
    await this.refreshUrl();
  }
  async back(opts?: NavOpts): Promise<boolean> {
    return this.goBack(opts);
  }
  async forward(opts?: NavOpts): Promise<boolean> {
    return this.goForward(opts);
  }
  async goBack(opts?: NavOpts): Promise<boolean> {
    await this.page.goBack(
      opts?.waitUntil ? { waitUntil: opts.waitUntil } : undefined,
    );
    const before = this.lastUrl;
    await this.refreshUrl();
    return this.lastUrl !== before;
  }
  async goForward(opts?: NavOpts): Promise<boolean> {
    await this.page.goForward(
      opts?.waitUntil ? { waitUntil: opts.waitUntil } : undefined,
    );
    const before = this.lastUrl;
    await this.refreshUrl();
    return this.lastUrl !== before;
  }

  url(): string {
    // Contract is sync; v4's accessor is an async RPC (V4_API_LOGS #9).
    // Best-effort last-observed value, refreshed by nav calls and wait().
    return this.lastUrl;
  }
  title(): Promise<string> {
    return this.page.title();
  }
  evaluate<R = unknown, Arg = unknown>(
    pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    return this.page.evaluate(pageFunctionOrExpression, arg);
  }
  screenshot(opts?: ScreenshotOpts): Promise<Buffer> {
    return this.page.screenshot(opts);
  }

  setViewport(): Promise<void> {
    throw new Error("v4_code: the v4 SDK exposes no viewport API");
  }
  setViewportSize(): Promise<void> {
    throw new Error("v4_code: the v4 SDK exposes no viewport API");
  }

  async wait(spec: WaitSpec): Promise<void> {
    if (spec.kind === "timeout") {
      await this.waitForTimeout(spec.timeoutMs);
      return;
    }
    if (spec.kind === "selector") {
      await this.waitForSelector(spec.selector, {
        timeout: spec.timeoutMs,
        state: spec.state,
      });
      return;
    }
    // load_state
    await this.page.waitForLoadState(spec.state ?? "load", spec.timeoutMs);
    await this.refreshUrl();
  }

  async waitForSelector(
    selector: string,
    opts?: {
      timeout?: number;
      state?: "attached" | "detached" | "visible" | "hidden";
    },
  ): Promise<boolean> {
    // No waitForSelector primitive in v4 — poll the locator.
    const state = opts?.state ?? "visible";
    const deadline = Date.now() + (opts?.timeout ?? 30_000);
    const locator = this.page.locator(selector);
    for (;;) {
      const [count, visible] = await Promise.all([
        locator.count(),
        locator.isVisible().catch(() => false),
      ]);
      const satisfied =
        state === "attached"
          ? count > 0
          : state === "detached"
            ? count === 0
            : state === "visible"
              ? visible
              : !visible;
      if (satisfied) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  waitForTimeout(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  locator(selector: string): CoreLocatorHandle {
    return new V4LocatorHandle(this.page.locator(selector));
  }

  async click(
    targetOrX: string | ActionTarget | number,
    maybeY?: number,
  ): Promise<void> {
    if (typeof targetOrX === "number" || typeof maybeY === "number") {
      throw new Error(
        "v4_code: coordinate clicks are unsupported (v4 is DOM-only)",
      );
    }
    await this.page.locator(targetSelector(targetOrX)).click();
  }

  async hover(
    targetOrX: string | ActionTarget | number,
    maybeY?: number,
  ): Promise<void> {
    if (typeof targetOrX === "number" || typeof maybeY === "number") {
      throw new Error(
        "v4_code: coordinate hover is unsupported (v4 is DOM-only)",
      );
    }
    await this.page.locator(targetSelector(targetOrX)).hover();
  }

  async scroll(
    _x: number,
    _y: number,
    deltaX: number,
    deltaY: number,
  ): Promise<void> {
    // No wheel primitive in v4 — emulate in the main frame.
    await this.page.evaluate(
      ({ dx, dy }: { dx: number; dy: number }) => window.scrollBy(dx, dy),
      { dx: deltaX, dy: deltaY },
    );
  }

  async type(
    targetOrText: string | ActionTarget | FocusedTarget,
    maybeText?: string,
  ): Promise<void> {
    if (maybeText === undefined) {
      // type(text) — focused element; route through keyPress per character.
      const text = targetOrText as string;
      for (const char of text) {
        await this.page.keyPress(char);
      }
      return;
    }
    const target = targetOrText as string | ActionTarget | FocusedTarget;
    if (typeof target !== "string" && target.kind === "focused") {
      for (const char of maybeText) {
        await this.page.keyPress(char);
      }
      return;
    }
    await this.page
      .locator(targetSelector(target as string | ActionTarget))
      .type(maybeText);
  }

  async press(
    targetOrKey: string | ActionTarget | FocusedTarget,
    maybeKey?: string,
  ): Promise<void> {
    if (maybeKey === undefined) {
      await this.page.keyPress(targetOrKey as string);
      return;
    }
    const target = targetOrKey as string | ActionTarget | FocusedTarget;
    if (typeof target !== "string" && target.kind === "focused") {
      await this.page.keyPress(maybeKey);
      return;
    }
    // Selector-targeted press: focus via click, then key.
    await this.page
      .locator(targetSelector(target as string | ActionTarget))
      .click();
    await this.page.keyPress(maybeKey);
  }
}

class V4CodeSession implements CoreSession {
  private handles = new Map<V4Page, V4PageHandle>();
  private nextId = 0;

  constructor(private readonly init: V4InitResult) {}

  private handleFor(page: V4Page): V4PageHandle {
    let handle = this.handles.get(page);
    if (!handle) {
      handle = new V4PageHandle(page, `v4-page-${this.nextId++}`);
      this.handles.set(page, handle);
    }
    return handle;
  }

  private get stagehand(): V4Stagehand {
    return this.init.stagehand;
  }

  async listPages(): Promise<CorePageHandle[]> {
    const pages = await this.stagehand.context.pages();
    return pages.map((p) => this.handleFor(p));
  }
  async activePage(): Promise<CorePageHandle> {
    const page = await this.stagehand.context.activePage();
    if (!page) throw new Error("v4_code: no active page");
    return this.handleFor(page);
  }
  async newPage(url?: string): Promise<CorePageHandle> {
    const page = await this.stagehand.context.newPage(url ? { url } : {});
    return this.handleFor(page);
  }
  async selectPage(pageId: string): Promise<void> {
    for (const [page, handle] of this.handles) {
      if (handle.id === pageId) {
        await this.stagehand.context.setActivePage(page);
        return;
      }
    }
    throw new Error(`v4_code: unknown page id "${pageId}"`);
  }
  async closePage(pageId: string): Promise<void> {
    for (const [page, handle] of this.handles) {
      if (handle.id === pageId) {
        await page.close();
        this.handles.delete(page);
        return;
      }
    }
    throw new Error(`v4_code: unknown page id "${pageId}"`);
  }
  async close(): Promise<void> {
    await this.stagehand.close();
  }
  async getArtifacts(): Promise<Artifact[]> {
    return [];
  }
  async getRawMetrics(): Promise<Record<string, unknown>> {
    const sessionId = this.stagehand.browser?.browserbaseSessionId;
    return {
      ...(sessionId ? { browserbaseSessionId: sessionId } : {}),
      metrics: await this.stagehand.metrics().catch((): undefined => undefined),
    };
  }
}

export class V4CodeTool implements CoreTool {
  readonly id = "v4_code";
  readonly surface = "code";
  readonly family = "stagehand_v4";
  readonly supportedStartupProfiles: StartupProfile[] = [
    "tool_launch_local",
    "tool_create_browserbase",
  ];
  readonly supportedCapabilities: CoreCapability[] = [
    ...SUPPORTED_CAPABILITIES,
  ];
  readonly supportedTargetKinds: TargetKind[] = ["selector", "focused"];

  async start(input: ToolStartInput): Promise<ToolStartResult> {
    if (!this.supportedStartupProfiles.includes(input.startupProfile)) {
      throw new Error(
        `v4_code does not support startup profile "${input.startupProfile}" yet ` +
          `(the v4 SDK owns its browser; CDP attach profiles need the SDK's ` +
          `cdp browser source plumbed through initV4)`,
      );
    }

    const init = await initV4({
      logger: input.logger,
      modelName: SURFACE_MODEL,
      configOverrides: {
        env:
          input.startupProfile === "tool_create_browserbase"
            ? "BROWSERBASE"
            : "LOCAL",
      },
    });

    const session = new V4CodeSession(init);
    return {
      session,
      cleanup: async () => {
        await init.stagehand.close().catch(() => {});
      },
      metadata: {
        environment:
          input.startupProfile === "tool_create_browserbase"
            ? "browserbase"
            : "local",
        browserOwnership: "tool",
        connectionMode:
          input.startupProfile === "tool_create_browserbase"
            ? "browserbase_native"
            : "launch",
      },
    };
  }
}

/**
 * v4_code agent exposure: the agent writes code against the Stagehand v4
 * SDK. The v4 SDK owns its browser (launched or created through the
 * extension stack via initV4), so unlike playwright_code/cdp_code there is
 * no runner-provided CDP endpoint. This is the arm that makes "v4 vs
 * Playwright" benchable under the same harness, model, and grader — only
 * the tool surface varies.
 */
export async function prepareLLMExposure(
  plan: ExternalHarnessTaskPlan,
  env: "LOCAL" | "BROWSERBASE",
  logger: EvalLogger,
  startupProfile?: StartupProfile,
): Promise<LLMExposure> {
  const resolvedProfile =
    startupProfile ??
    (env === "BROWSERBASE" ? "tool_create_browserbase" : "tool_launch_local");
  if (
    resolvedProfile !== "tool_launch_local" &&
    resolvedProfile !== "tool_create_browserbase"
  ) {
    throw new EvalsError(
      `v4_code startup profile "${resolvedProfile}" is not valid for Claude Code. Use tool_launch_local or tool_create_browserbase (the v4 SDK owns its browser).`,
    );
  }

  // The surface's internal SDK model (drives act/extract/observe inside
  // v4); the benchmark's model drives the agent harness itself. Fixed for
  // comparability, same convention as the v4_code CoreTool.
  const v4 = await initV4({
    logger,
    modelName: SURFACE_MODEL,
    configOverrides: {
      env:
        resolvedProfile === "tool_create_browserbase" ? "BROWSERBASE" : "LOCAL",
    },
  });

  logger.log({
    category: "claude_code",
    message: `Initialized v4_code (Stagehand v4 SDK) runtime for Claude Code run tool.`,
    level: 1,
    auxiliary: {
      startupProfile: { value: resolvedProfile, type: "string" },
      environment: { value: env, type: "string" },
      ...(v4.sessionUrl && {
        sessionUrl: { value: v4.sessionUrl, type: "string" },
      }),
    },
  });

  const stagehand = v4.stagehand;
  return {
    kind: "code_handles",
    handles: { stagehand, page: v4.page, z },
    promptInstructions: buildV4CodePromptInstructions(),
    runTool: {
      description: [
        "Execute JavaScript against the initialized Stagehand v4 SDK.",
        "The snippet runs inside an async function with stagehand, page, startUrl, task, z (zod), and console in scope.",
        "Use await directly. Return a JSON-serializable value when useful.",
      ].join(" "),
      codeParamDescription:
        "JavaScript function body to execute. stagehand/page/startUrl/task/z are already in scope.",
      denyMessage: `Use Bash for inspection and ${LLM_RUN_TOOL_NAME} for browser automation.`,
      task: { instruction: plan.instruction, startUrl: plan.startUrl },
      console,
    },
    ...(v4.sessionUrl && { metadata: { sessionUrl: v4.sessionUrl } }),
    captureFinalState: async () => {
      const artifact: { screenshot?: Buffer; url?: string } = {};
      try {
        artifact.screenshot = await v4.page.screenshot();
      } catch {
        // best-effort only
      }
      try {
        artifact.url = await v4.page.url();
      } catch {
        // best-effort only
      }
      return artifact;
    },
    cleanup: async () => {
      try {
        await stagehand.close();
      } catch {
        // best-effort only
      }
    },
  };
}

function buildV4CodePromptInstructions(): string {
  return [
    "Browser tool surface: v4_code (Stagehand v4 SDK).",
    `Use the ${LLM_RUN_TOOL_NAME} tool for browser automation. It exposes an initialized Stagehand v4 client (stagehand), its active page, startUrl, and task object.`,
    "AI methods live on the client: await stagehand.act('instruction'), await stagehand.observe('instruction'), await stagehand.extract('instruction', zodSchema) — a zod `z` is in scope for extract schemas (use single-word keys).",
    "Deterministic methods live on the page: await page.goto(url), page.locator(selector).click()/fill()/type(), await page.url(), await page.title(), await page.screenshot().",
    "Page accessors are async RPCs — always await them.",
    "The first browser action should usually be: await page.goto(startUrl, { waitUntil: 'domcontentloaded' }).",
    "Use Bash for inspection and lightweight scripting. Do not create a separate browser process.",
    "Do not edit repository files.",
    "Return useful JSON-serializable values from run snippets so you can inspect progress.",
  ].join("\n");
}
