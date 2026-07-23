import type { V3 } from "@browserbasehq/stagehand";
import { endBrowserbaseSession } from "../../browserbaseCleanup.js";
import { initV3, type V3InitResult } from "../../initV3.js";
import type {
  CoreLocatorHandle,
  CorePageHandle,
  CoreSession,
  CoreTool,
  CoreCapability,
  StartupProfile,
  ToolStartInput,
  ToolStartResult,
} from "../contracts/tool.js";
import type {
  ActionTarget,
  TargetKind,
  WaitSpec,
} from "../contracts/targets.js";
import type { PageRepresentation } from "../contracts/representation.js";
import type { Artifact, ConnectionMode } from "../contracts/results.js";

type UnderstudyPage = ReturnType<V3["context"]["pages"]>[number];
type UnderstudyLocator = ReturnType<UnderstudyPage["locator"]>;

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

class UnderstudyLocatorHandle implements CoreLocatorHandle {
  constructor(private readonly locatorHandle: UnderstudyLocator) {}

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

class UnderstudyPageHandle implements CorePageHandle {
  readonly id: string;

  constructor(private readonly page: UnderstudyPage) {
    this.id = this.page.targetId();
  }

  async goto(
    url: string,
    opts?: {
      waitUntil?: "load" | "domcontentloaded" | "networkidle";
      timeoutMs?: number;
    },
  ): Promise<void> {
    await this.page.goto(url, opts);
  }

  async reload(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<void> {
    await this.page.reload(opts);
  }

  async back(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<boolean> {
    return (await this.page.goBack(opts)) !== null;
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
    return (await this.page.goForward(opts)) !== null;
  }

  async goForward(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<boolean> {
    return this.forward(opts);
  }

  url(): string {
    return this.page.url();
  }

  async title(): Promise<string> {
    return this.page.title();
  }

  async evaluate<R = unknown, Arg = unknown>(
    pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    return this.page.mainFrame().evaluate(pageFunctionOrExpression, arg);
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
    return new UnderstudyLocatorHandle(this.page.locator(selector));
  }

  async click(
    targetOrX: string | ActionTarget | number,
    y?: number,
  ): Promise<void> {
    if (typeof targetOrX === "number") {
      if (typeof y !== "number") {
        throw new Error("click(x, y) requires both numeric coordinates");
      }
      await this.page.click(targetOrX, y);
      return;
    }

    const target =
      typeof targetOrX === "string"
        ? ({ kind: "selector", value: targetOrX } as const)
        : targetOrX;

    switch (target.kind) {
      case "selector":
        await this.page.locator(target.value).click();
        return;
      case "coords":
        await this.page.click(target.x, target.y);
        return;
      default:
        throw new Error(
          `understudy_code does not support click target kind "${target.kind}" yet`,
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
      await this.page.hover(targetOrX, y);
      return;
    }

    const target =
      typeof targetOrX === "string"
        ? ({ kind: "selector", value: targetOrX } as const)
        : targetOrX;

    switch (target.kind) {
      case "selector":
        await this.page.locator(target.value).hover();
        return;
      case "coords":
        await this.page.hover(target.x, target.y);
        return;
      default:
        throw new Error(
          `understudy_code does not support hover target kind "${target.kind}" yet`,
        );
    }
  }

  async scroll(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
  ): Promise<void> {
    await this.page.scroll(x, y, deltaX, deltaY);
  }

  async type(
    targetOrText: string | ActionTarget | { kind: "focused" },
    text?: string,
  ): Promise<void> {
    if (typeof targetOrText === "string" && typeof text === "undefined") {
      await this.page.type(targetOrText);
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
        throw new Error(
          `understudy_code does not support type target kind "${target.kind}" yet`,
        );
    }
  }

  async press(
    targetOrKey: string | ActionTarget | { kind: "focused" },
    key?: string,
  ): Promise<void> {
    if (typeof targetOrKey === "string" && typeof key === "undefined") {
      await this.page.keyPress(targetOrKey);
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
        throw new Error(
          `understudy_code does not support press target kind "${target.kind}" yet`,
        );
    }
  }

  async represent(opts?: {
    includeIframes?: boolean;
  }): Promise<PageRepresentation> {
    const snapshot = await this.page.snapshot({
      includeIframes: opts?.includeIframes,
    });
    const content = snapshot.formattedTree;

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

class UnderstudySession implements CoreSession {
  private readonly handles = new Map<string, UnderstudyPageHandle>();
  private closed = false;

  constructor(private readonly v3Result: V3InitResult) {}

  private wrap(page: UnderstudyPage): UnderstudyPageHandle {
    const id = page.targetId();
    const existing = this.handles.get(id);
    if (existing) return existing;
    const handle = new UnderstudyPageHandle(page);
    this.handles.set(id, handle);
    return handle;
  }

  async listPages(): Promise<CorePageHandle[]> {
    return this.v3Result.v3.context.pages().map((page) => this.wrap(page));
  }

  async activePage(): Promise<CorePageHandle> {
    const page = this.v3Result.v3.context.activePage();
    if (page) return this.wrap(page);
    const pages = this.v3Result.v3.context.pages();
    if (pages.length === 0) {
      throw new Error("No active page available");
    }
    return this.wrap(pages[0]);
  }

  async newPage(url?: string): Promise<CorePageHandle> {
    return this.wrap(await this.v3Result.v3.context.newPage(url));
  }

  async selectPage(pageId: string): Promise<void> {
    const page = this.v3Result.v3.context
      .pages()
      .find((candidate) => candidate.targetId() === pageId);
    if (!page) {
      throw new Error(`Unknown page id "${pageId}"`);
    }
    this.v3Result.v3.context.setActivePage(page);
  }

  async closePage(pageId: string): Promise<void> {
    const page = this.v3Result.v3.context
      .pages()
      .find((candidate) => candidate.targetId() === pageId);
    if (!page) {
      throw new Error(`Unknown page id "${pageId}"`);
    }
    await page.close();
    this.handles.delete(pageId);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.v3Result.v3.close();
    } catch {
      // best-effort
    }
    await endBrowserbaseSession(this.v3Result.v3);
  }

  async getArtifacts(): Promise<Artifact[]> {
    return [];
  }

  async getRawMetrics(): Promise<Record<string, unknown>> {
    return {
      browserbaseSessionId: this.v3Result.v3.browserbaseSessionID,
      browserbaseSessionUrl: this.v3Result.v3.browserbaseSessionURL,
    };
  }
}

function connectionModeFromProfile(
  startupProfile: StartupProfile,
  endpointKind?: "ws" | "http",
): ConnectionMode {
  if (startupProfile === "tool_launch_local") {
    return "launch";
  }

  if (startupProfile === "tool_create_browserbase") {
    return "browserbase_native";
  }

  if (
    startupProfile === "runner_provided_local_cdp" ||
    startupProfile === "runner_provided_browserbase_cdp" ||
    startupProfile === "tool_attach_local_cdp" ||
    startupProfile === "tool_attach_browserbase"
  ) {
    return endpointKind === "http" ? "attach_http" : "attach_ws";
  }

  return "launch";
}

export class UnderstudyCodeTool implements CoreTool {
  readonly id = "understudy_code";
  readonly surface = "code";
  readonly family = "understudy";
  readonly supportedStartupProfiles: StartupProfile[] = [
    "runner_provided_local_cdp",
    "runner_provided_browserbase_cdp",
    "tool_launch_local",
    "tool_create_browserbase",
    "tool_attach_browserbase",
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
    if (input.startupProfile === "tool_attach_local_cdp") {
      throw new Error(
        `understudy_code does not support startup profile "${input.startupProfile}" yet`,
      );
    }

    const v3Result = await initV3({
      logger: input.logger,
      modelName: "openai/gpt-4.1-mini",
      configOverrides: {
        env:
          input.startupProfile.startsWith("runner_provided") ||
          input.startupProfile === "tool_attach_browserbase"
            ? "LOCAL"
            : input.environment,
        localBrowserLaunchOptions: {
          headless: true,
          ...(process.env.CHROME_PATH
            ? { executablePath: process.env.CHROME_PATH }
            : {}),
          ...(input.providedEndpoint
            ? {
                cdpUrl: input.providedEndpoint.url,
                cdpHeaders: input.providedEndpoint.headers,
              }
            : {}),
        },
        ...(input.startupProfile === "tool_attach_browserbase" &&
        input.browserbase?.sessionId
          ? { browserbaseSessionID: input.browserbase.sessionId }
          : {}),
        ...(input.startupProfile === "tool_create_browserbase" &&
        input.browserbase?.sessionParams
          ? {
              browserbaseSessionCreateParams: input.browserbase
                .sessionParams as never,
            }
          : {}),
      },
    });

    const session = new UnderstudySession(v3Result);

    return {
      session,
      cleanup: async () => {
        await session.close();
      },
      metadata: {
        environment:
          input.environment === "BROWSERBASE" ? "browserbase" : "local",
        browserOwnership: input.startupProfile.startsWith("runner_provided")
          ? "runner"
          : "tool",
        connectionMode: connectionModeFromProfile(
          input.startupProfile,
          input.providedEndpoint?.kind,
        ),
        startupProfile: input.startupProfile,
      },
    };
  }
}
