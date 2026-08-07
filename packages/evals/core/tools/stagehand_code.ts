import type { Locator, Page, Stagehand } from "@browserbasehq/stagehand";
import type { ProbeEvidence } from "stagehand-v3";
import { z } from "zod/v4";
import { initStagehand, type StagehandInitResult } from "../../initStagehand.js";
import type { PageRepresentation } from "../contracts/representation.js";
import type { Artifact, ConnectionMode } from "../contracts/results.js";
import type { ActionTarget, TargetKind, WaitSpec } from "../contracts/targets.js";
import {
  AGENT_RUN_TOOL_NAME,
  type CoreCapability,
  type CoreLocatorHandle,
  type CorePageHandle,
  type CoreSession,
  type CoreTool,
  type StartupProfile,
  type ToolStartInput,
  type ToolStartResult,
} from "../contracts/tool.js";

const SURFACE_MODEL = "openai/gpt-4.1-mini";

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

class StagehandLocatorHandle implements CoreLocatorHandle {
  constructor(private readonly locatorHandle: Locator) {}

  async count(): Promise<number> {
    return this.locatorHandle.count();
  }

  async click(): Promise<void> {
    await this.locatorHandle.click();
  }

  async hover(): Promise<void> {
    await this.locatorHandle.hover();
  }

  async fill(value: string): Promise<void> {
    await this.locatorHandle.fill(value);
  }

  async type(text: string, opts?: { delay?: number }): Promise<void> {
    await this.locatorHandle.type(text, opts);
  }

  async isVisible(): Promise<boolean> {
    return this.locatorHandle.isVisible();
  }

  async textContent(): Promise<string | null> {
    return this.locatorHandle.textContent();
  }

  async inputValue(): Promise<string> {
    return this.locatorHandle.inputValue();
  }
}

class StagehandPageHandle implements CorePageHandle {
  readonly id: string;
  private lastUrl: string;

  constructor(private readonly page: Page) {
    this.id = page.pageId;
    this.lastUrl = page.ref.url ?? "about:blank";
  }

  private async refreshUrl(): Promise<void> {
    this.lastUrl = await this.page.url();
  }

  async goto(
    url: string,
    opts?: {
      waitUntil?: "load" | "domcontentloaded" | "networkidle";
      timeoutMs?: number;
    },
  ): Promise<void> {
    await this.page.goto(url, {
      waitUntil: opts?.waitUntil,
      timeout: opts?.timeoutMs,
    });
    await this.refreshUrl();
  }

  async reload(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<void> {
    await this.page.reload({
      waitUntil: opts?.waitUntil,
      timeout: opts?.timeoutMs,
    });
    await this.refreshUrl();
  }

  async back(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<boolean> {
    const response = await this.page.goBack({
      waitUntil: opts?.waitUntil,
      timeout: opts?.timeoutMs,
    });
    await this.refreshUrl();
    return response !== null;
  }

  async goBack(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<boolean> {
    return this.back(opts);
  }

  async forward(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<boolean> {
    const response = await this.page.goForward({
      waitUntil: opts?.waitUntil,
      timeout: opts?.timeoutMs,
    });
    await this.refreshUrl();
    return response !== null;
  }

  async goForward(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<boolean> {
    return this.forward(opts);
  }

  url(): string {
    return this.lastUrl;
  }

  async title(): Promise<string> {
    return this.page.title();
  }

  async evaluate<R = unknown, Arg = unknown>(
    pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    return this.page.evaluate(pageFunctionOrExpression, arg);
  }

  async screenshot(opts?: {
    fullPage?: boolean;
    type?: "png" | "jpeg";
    quality?: number;
  }): Promise<Buffer> {
    return this.page.screenshot(opts);
  }

  async setViewport(size: { width: number; height: number }): Promise<void> {
    await this.page.setViewportSize(size.width, size.height);
  }

  async setViewportSize(width: number, height: number): Promise<void> {
    await this.page.setViewportSize(width, height);
  }

  async wait(spec: WaitSpec): Promise<void> {
    switch (spec.kind) {
      case "selector":
        await this.page.waitForSelector(spec.selector, {
          timeout: spec.timeoutMs,
          state: spec.state,
        });
        return;
      case "timeout":
        await this.page.waitForTimeout(spec.timeoutMs);
        return;
      case "load_state":
        await this.page.waitForLoadState(spec.state, spec.timeoutMs);
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
    return this.page.waitForSelector(selector, opts);
  }

  async waitForTimeout(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  locator(selector: string): CoreLocatorHandle {
    return new StagehandLocatorHandle(this.page.locator(selector));
  }

  async click(targetOrX: string | ActionTarget | number, y?: number): Promise<void> {
    if (typeof targetOrX === "number") {
      if (typeof y !== "number") throw new Error("click(x, y) requires both numeric coordinates");
      await this.page.click(targetOrX, y);
      return;
    }

    const target =
      typeof targetOrX === "string" ? ({ kind: "selector", value: targetOrX } as const) : targetOrX;
    switch (target.kind) {
      case "selector":
        await this.page.locator(target.value).click();
        return;
      case "coords":
        await this.page.click(target.x, target.y);
        return;
      default:
        throw new Error(`stagehand_code does not support click target kind "${target.kind}" yet`);
    }
  }

  async hover(targetOrX: string | ActionTarget | number, y?: number): Promise<void> {
    if (typeof targetOrX === "number") {
      if (typeof y !== "number") throw new Error("hover(x, y) requires both numeric coordinates");
      await this.page.hover(targetOrX, y);
      return;
    }

    const target =
      typeof targetOrX === "string" ? ({ kind: "selector", value: targetOrX } as const) : targetOrX;
    switch (target.kind) {
      case "selector":
        await this.page.locator(target.value).hover();
        return;
      case "coords":
        await this.page.hover(target.x, target.y);
        return;
      default:
        throw new Error(`stagehand_code does not support hover target kind "${target.kind}" yet`);
    }
  }

  async scroll(x: number, y: number, deltaX: number, deltaY: number): Promise<void> {
    await this.page.scroll(x, y, deltaX, deltaY);
  }

  async type(
    targetOrText: string | ActionTarget | { kind: "focused" },
    text?: string,
  ): Promise<void> {
    if (typeof targetOrText === "string" && text === undefined) {
      await this.page.type(targetOrText);
      return;
    }
    if (typeof text !== "string") throw new Error("type(target, text) requires text");

    const target =
      typeof targetOrText === "string"
        ? ({ kind: "selector", value: targetOrText } as const)
        : targetOrText;
    switch (target.kind) {
      case "focused":
        await this.page.type(text);
        return;
      case "selector":
        await this.page.locator(target.value).type(text);
        return;
      case "coords":
        await this.page.click(target.x, target.y);
        await this.page.type(text);
        return;
      default:
        throw new Error(`stagehand_code does not support type target kind "${target.kind}" yet`);
    }
  }

  async press(
    targetOrKey: string | ActionTarget | { kind: "focused" },
    key?: string,
  ): Promise<void> {
    if (typeof targetOrKey === "string" && key === undefined) {
      await this.page.keyPress(targetOrKey);
      return;
    }
    if (typeof key !== "string") throw new Error("press(target, key) requires key");

    const target =
      typeof targetOrKey === "string"
        ? ({ kind: "selector", value: targetOrKey } as const)
        : targetOrKey;
    switch (target.kind) {
      case "focused":
        await this.page.keyPress(key);
        return;
      case "selector":
        await this.page.locator(target.value).click();
        await this.page.keyPress(key);
        return;
      case "coords":
        await this.page.click(target.x, target.y);
        await this.page.keyPress(key);
        return;
      default:
        throw new Error(`stagehand_code does not support press target kind "${target.kind}" yet`);
    }
  }

  async represent(opts?: { includeIframes?: boolean }): Promise<PageRepresentation> {
    const snapshot = await this.page.snapshot({ includeIframes: opts?.includeIframes });
    const content = snapshot.formattedTree;
    return {
      kind: "snapshot_refs",
      content,
      metadata: {
        bytes: Buffer.byteLength(content, "utf8"),
        tokenEstimate: Math.ceil(content.length / 4),
        refCount: Object.keys(snapshot.xpathMap).length,
      },
      raw: snapshot,
    };
  }
}

class StagehandCodeSession implements CoreSession {
  private readonly handles = new Map<string, StagehandPageHandle>();
  private closed = false;

  constructor(private readonly sdk: StagehandInitResult) {}

  private wrap(page: Page): StagehandPageHandle {
    const existing = this.handles.get(page.pageId);
    if (existing) return existing;
    const handle = new StagehandPageHandle(page);
    this.handles.set(page.pageId, handle);
    return handle;
  }

  async listPages(): Promise<CorePageHandle[]> {
    return (await this.sdk.stagehand.browser.context.pages()).map((page) => this.wrap(page));
  }

  async activePage(): Promise<CorePageHandle> {
    const page = await this.sdk.stagehand.browser.context.activePage();
    if (page) return this.wrap(page);
    const pages = await this.sdk.stagehand.browser.context.pages();
    if (pages.length === 0) throw new Error("No active page available");
    return this.wrap(pages[0]);
  }

  async newPage(url?: string): Promise<CorePageHandle> {
    return this.wrap(await this.sdk.stagehand.browser.context.newPage(url));
  }

  async selectPage(pageId: string): Promise<void> {
    const page = (await this.sdk.stagehand.browser.context.pages()).find(
      (candidate) => candidate.pageId === pageId,
    );
    if (!page) throw new Error(`Unknown page id "${pageId}"`);
    await this.sdk.stagehand.browser.context.setActivePage(page);
  }

  async closePage(pageId: string): Promise<void> {
    const page = (await this.sdk.stagehand.browser.context.pages()).find(
      (candidate) => candidate.pageId === pageId,
    );
    if (!page) throw new Error(`Unknown page id "${pageId}"`);
    await page.close();
    this.handles.delete(pageId);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.sdk.stagehand.close();
    } finally {
      await this.sdk.stagehand.browser.close();
    }
  }

  async getArtifacts(): Promise<Artifact[]> {
    return [];
  }

  async getRawMetrics(): Promise<Record<string, unknown>> {
    return {
      ...(await this.sdk.stagehand.metrics()),
      browserProvider: this.sdk.stagehand.browser.provider,
      browserOrigin: this.sdk.stagehand.browser.origin,
    };
  }
}

async function captureStagehandEvidence(stagehand: Stagehand): Promise<ProbeEvidence> {
  const page = await stagehand.browser.context.activePage().catch((): undefined => undefined);
  if (!page) return {};

  const evidence: ProbeEvidence = {};
  try {
    evidence.screenshot = await page.screenshot();
  } catch {
    // Best effort: preserve other evidence modalities.
  }
  try {
    evidence.url = await page.url();
  } catch {
    // Best effort: preserve other evidence modalities.
  }
  try {
    evidence.ariaTree = (await page.snapshot({ includeIframes: true })).formattedTree;
  } catch {
    // Best effort: preserve other evidence modalities.
  }
  return evidence;
}

function connectionModeFromProfile(startupProfile: StartupProfile): ConnectionMode {
  return startupProfile === "tool_create_browserbase" ? "browserbase_native" : "launch";
}

export class StagehandCodeTool implements CoreTool {
  readonly id = "stagehand_code";
  readonly surface = "code";
  readonly family = "stagehand";
  readonly supportedStartupProfiles: StartupProfile[] = [
    "tool_launch_local",
    "tool_create_browserbase",
  ];
  readonly supportedCapabilities: CoreCapability[] = [...SUPPORTED_CAPABILITIES];
  readonly supportedTargetKinds: TargetKind[] = ["selector", "coords", "focused"];

  async start(input: ToolStartInput): Promise<ToolStartResult> {
    if (!this.supportedStartupProfiles.includes(input.startupProfile)) {
      throw new Error(
        `stagehand_code does not support startup profile "${input.startupProfile}" yet`,
      );
    }

    const sdk = await initStagehand({
      logger: input.logger,
      modelName: SURFACE_MODEL,
      environment: input.startupProfile === "tool_create_browserbase" ? "BROWSERBASE" : "LOCAL",
    });
    const session = new StagehandCodeSession(sdk);

    input.logger.log({
      category: "stagehand_code",
      message: "Initialized stagehand_code Stagehand SDK runtime.",
      level: 1,
      auxiliary: {
        startupProfile: { value: input.startupProfile, type: "string" },
        environment: { value: input.environment, type: "string" },
      },
    });

    return {
      session,
      agentMount: {
        via: "handles",
        handles: { stagehand: sdk.stagehand, page: sdk.page, z },
        promptInstructions: buildStagehandCodePromptInstructions(),
        runTool: {
          description: [
            "Execute JavaScript against the initialized Stagehand SDK.",
            "The snippet runs inside an async function with stagehand, page, startUrl, task, z (zod), and console in scope.",
            "Use await directly. Return a JSON-serializable value when useful.",
          ].join(" "),
          codeParamDescription:
            "JavaScript function body to execute. stagehand/page/startUrl/task/z are already in scope.",
          denyMessage: `Use Bash for inspection and ${AGENT_RUN_TOOL_NAME} for browser automation.`,
        },
      },
      captureEvidence: () => captureStagehandEvidence(sdk.stagehand),
      cleanup: () => session.close(),
      metadata: {
        environment: input.environment === "BROWSERBASE" ? "browserbase" : "local",
        browserOwnership: "tool",
        connectionMode: connectionModeFromProfile(input.startupProfile),
        startupProfile: input.startupProfile,
      },
    };
  }
}

export function buildStagehandCodePromptInstructions(): string {
  return [
    "Browser tool surface: stagehand_code (Stagehand SDK).",
    `Use the ${AGENT_RUN_TOOL_NAME} tool for browser automation. It exposes an initialized Stagehand client (stagehand), its initial page, startUrl, and task object.`,
    "AI methods live on the client: await stagehand.act('instruction'), await stagehand.observe('instruction'), await stagehand.extract('instruction', zodSchema) — a zod `z` is in scope for extract schemas (use single-word keys).",
    "The page implements exactly these methods:",
    "  page: goto(url, opts), reload(), goBack()/goForward(), url(), title(), evaluate(fn, arg), screenshot(opts), setViewportSize(w,h), waitForSelector(sel, opts), waitForTimeout(ms), click(x,y), hover(x,y), scroll(x,y,dx,dy), type(text), keyPress(key).",
    "  page.locator(selector): count(), click(), hover(), fill(value), type(text), isVisible(), textContent(), inputValue().",
    "For behavior not listed above, use await stagehand.act('describe the action').",
    "Page accessors are async RPCs — always await them.",
    "The first browser action should usually be: await page.goto(startUrl, { waitUntil: 'domcontentloaded' }).",
    "Prefer batching complete workflows into each run call: chain multiple act/observe/extract and page steps in one snippet and return the final result.",
    "Use Bash for inspection and lightweight scripting. Do not create a separate browser process.",
    "Do not edit repository files.",
    "Return useful JSON-serializable values from run snippets so you can inspect progress.",
  ].join("\n");
}
