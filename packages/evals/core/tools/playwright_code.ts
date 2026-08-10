import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright";
import { resolveLocalChromeExecutablePath } from "../targets/localChrome.js";
import type {
  CoreCapability,
  CoreLocatorHandle,
  CorePageHandle,
  CoreSession,
  CoreTool,
  StartupProfile,
  ToolStartInput,
  ToolStartResult,
} from "../contracts/tool.js";
import type { PageRepresentation } from "../contracts/representation.js";
import type { Artifact, ConnectionMode } from "../contracts/results.js";
import type {
  ActionTarget,
  TargetKind,
  WaitSpec,
} from "../contracts/targets.js";

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

function countAccessibilityNodes(node: unknown): number {
  if (!node || typeof node !== "object") return 0;
  const children =
    "children" in node && Array.isArray(node.children) ? node.children : [];
  return (
    1 + children.reduce((sum, child) => sum + countAccessibilityNodes(child), 0)
  );
}

class PlaywrightLocatorHandle implements CoreLocatorHandle {
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

class PlaywrightPageHandle implements CorePageHandle {
  constructor(
    private readonly page: Page,
    readonly id: string,
  ) {}

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
  }

  async reload(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<void> {
    await this.page.reload({
      waitUntil: opts?.waitUntil,
      timeout: opts?.timeoutMs,
    });
  }

  async back(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<boolean> {
    return (
      (await this.page.goBack({
        waitUntil: opts?.waitUntil,
        timeout: opts?.timeoutMs,
      })) !== null
    );
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
    return (
      (await this.page.goForward({
        waitUntil: opts?.waitUntil,
        timeout: opts?.timeoutMs,
      })) !== null
    );
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
    return this.page.evaluate(pageFunctionOrExpression as never, arg);
  }

  async screenshot(opts?: {
    fullPage?: boolean;
    type?: "png" | "jpeg";
    quality?: number;
  }): Promise<Buffer> {
    return this.page.screenshot(opts);
  }

  async setViewport(size: { width: number; height: number }): Promise<void> {
    await this.page.setViewportSize(size);
  }

  async setViewportSize(width: number, height: number): Promise<void> {
    await this.page.setViewportSize({ width, height });
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
        await this.page.waitForLoadState(spec.state, {
          timeout: spec.timeoutMs,
        });
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
    await this.page.waitForSelector(selector, opts);
    return true;
  }

  async waitForTimeout(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  locator(selector: string): CoreLocatorHandle {
    return new PlaywrightLocatorHandle(this.page.locator(selector));
  }

  private roleTarget(
    target: Extract<ActionTarget, { kind: "role_name" }>,
  ): Locator {
    return this.page.getByRole(target.role as never, {
      name: target.name,
    });
  }

  private textTarget(target: Extract<ActionTarget, { kind: "text" }>): Locator {
    return this.page.getByText(target.text);
  }

  async click(
    targetOrX: string | ActionTarget | number,
    y?: number,
  ): Promise<void> {
    if (typeof targetOrX === "number") {
      if (typeof y !== "number") {
        throw new Error("click(x, y) requires both numeric coordinates");
      }
      await this.page.mouse.click(targetOrX, y);
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
        await this.page.mouse.click(target.x, target.y);
        return;
      case "role_name":
        await this.roleTarget(target).click();
        return;
      case "text":
        await this.textTarget(target).click();
        return;
      default:
        throw new Error(
          `playwright_code does not support click target kind "${target.kind}" yet`,
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
      await this.page.mouse.move(targetOrX, y);
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
        await this.page.mouse.move(target.x, target.y);
        return;
      case "role_name":
        await this.roleTarget(target).hover();
        return;
      case "text":
        await this.textTarget(target).hover();
        return;
      default:
        throw new Error(
          `playwright_code does not support hover target kind "${target.kind}" yet`,
        );
    }
  }

  async scroll(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
  ): Promise<void> {
    await this.page.mouse.move(x, y);
    await this.page.mouse.wheel(deltaX, deltaY);
  }

  async type(
    targetOrText: string | ActionTarget | { kind: "focused" },
    text?: string,
  ): Promise<void> {
    if (typeof targetOrText === "string" && typeof text === "undefined") {
      await this.page.keyboard.type(targetOrText);
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
        await this.page.keyboard.type(text);
        return;
      case "selector":
        await this.page.locator(target.value).type(text);
        return;
      case "coords":
        await this.page.mouse.click(target.x, target.y);
        await this.page.keyboard.type(text);
        return;
      case "role_name":
        await this.roleTarget(target).type(text);
        return;
      case "text":
        await this.textTarget(target).click();
        await this.page.keyboard.type(text);
        return;
      default:
        throw new Error(
          `playwright_code does not support type target kind "${target.kind}" yet`,
        );
    }
  }

  async press(
    targetOrKey: string | ActionTarget | { kind: "focused" },
    key?: string,
  ): Promise<void> {
    if (typeof targetOrKey === "string" && typeof key === "undefined") {
      await this.page.keyboard.press(targetOrKey);
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
        await this.page.keyboard.press(key);
        return;
      case "selector":
        await this.page.locator(target.value).click();
        await this.page.keyboard.press(key);
        return;
      case "coords":
        await this.page.mouse.click(target.x, target.y);
        await this.page.keyboard.press(key);
        return;
      case "role_name":
        await this.roleTarget(target).click();
        await this.page.keyboard.press(key);
        return;
      case "text":
        await this.textTarget(target).click();
        await this.page.keyboard.press(key);
        return;
      default:
        throw new Error(
          `playwright_code does not support press target kind "${target.kind}" yet`,
        );
    }
  }

  async represent(): Promise<PageRepresentation> {
    const snapshot = await this.page.accessibility.snapshot({
      interestingOnly: false,
    });
    const content = JSON.stringify(snapshot, null, 2);

    return {
      kind: "accessibility_tree",
      content,
      metadata: {
        bytes: Buffer.byteLength(content, "utf8"),
        tokenEstimate: Math.ceil(content.length / 4),
        nodeCount: countAccessibilityNodes(snapshot),
      },
      raw: snapshot,
    };
  }
}

class PlaywrightSession implements CoreSession {
  private readonly handles = new WeakMap<Page, PlaywrightPageHandle>();
  private readonly pageIds = new WeakMap<Page, string>();
  private pageCounter = 0;
  private activePageId: string | null = null;
  private closed = false;

  constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    initialPage?: Page,
  ) {
    if (initialPage) {
      const handle = this.wrap(initialPage);
      this.activePageId = handle.id;
    }
  }

  private nextPageId(): string {
    this.pageCounter += 1;
    return `page-${this.pageCounter}`;
  }

  private wrap(page: Page): PlaywrightPageHandle {
    const existing = this.handles.get(page);
    if (existing) return existing;

    const id = this.pageIds.get(page) ?? this.nextPageId();
    this.pageIds.set(page, id);

    const handle = new PlaywrightPageHandle(page, id);
    this.handles.set(page, handle);
    return handle;
  }

  async listPages(): Promise<CorePageHandle[]> {
    return this.context.pages().map((page: Page) => this.wrap(page));
  }

  async activePage(): Promise<CorePageHandle> {
    if (this.activePageId) {
      const active = this.context
        .pages()
        .find(
          (candidate: Page) => this.wrap(candidate).id === this.activePageId,
        );
      if (active) return this.wrap(active);
    }

    const page = this.context.pages()[0];
    if (!page) {
      throw new Error("No active page available");
    }
    const handle = this.wrap(page);
    this.activePageId = handle.id;
    return handle;
  }

  async newPage(url?: string): Promise<CorePageHandle> {
    const page = await this.context.newPage();
    const handle = this.wrap(page);
    this.activePageId = handle.id;
    if (url) {
      await page.goto(url);
    }
    return handle;
  }

  async selectPage(pageId: string): Promise<void> {
    const page = this.context
      .pages()
      .find((candidate: Page) => this.wrap(candidate).id === pageId);
    if (!page) {
      throw new Error(`Unknown page id "${pageId}"`);
    }
    this.activePageId = pageId;
    await page.bringToFront();
  }

  async closePage(pageId: string): Promise<void> {
    const page = this.context
      .pages()
      .find((candidate: Page) => this.wrap(candidate).id === pageId);
    if (!page) {
      throw new Error(`Unknown page id "${pageId}"`);
    }
    await page.close();
    if (this.activePageId === pageId) {
      this.activePageId = this.context.pages()[0]
        ? this.wrap(this.context.pages()[0]).id
        : null;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.browser.close();
  }

  async getArtifacts(): Promise<Artifact[]> {
    return [];
  }

  async getRawMetrics(): Promise<Record<string, unknown>> {
    return {
      pageCount: this.context.pages().length,
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

export class PlaywrightCodeTool implements CoreTool {
  readonly id = "playwright_code";
  readonly surface = "code";
  readonly family = "playwright";
  readonly supportedStartupProfiles: StartupProfile[] = [
    "tool_launch_local",
    "runner_provided_local_cdp",
    "runner_provided_browserbase_cdp",
    "tool_attach_local_cdp",
    "tool_attach_browserbase",
  ];
  readonly supportedCapabilities: CoreCapability[] = [
    ...SUPPORTED_CAPABILITIES,
  ];
  readonly supportedTargetKinds: TargetKind[] = [
    "selector",
    "coords",
    "focused",
    "role_name",
    "text",
  ];

  async start(input: ToolStartInput): Promise<ToolStartResult> {
    let browser: Browser;
    let context: BrowserContext;
    let initialPage: Page | undefined;

    if (input.startupProfile === "tool_launch_local") {
      const executablePath = resolveLocalChromeExecutablePath();
      browser = await chromium.launch({
        headless: true,
        executablePath,
        args: [
          ...(process.env.CI ? ["--no-sandbox"] : []),
          "--ignore-certificate-errors",
        ],
      });
      context = await browser.newContext({
        ignoreHTTPSErrors: true,
      });
      initialPage = await context.newPage();
    } else if (
      input.startupProfile === "runner_provided_local_cdp" ||
      input.startupProfile === "runner_provided_browserbase_cdp" ||
      input.startupProfile === "tool_attach_local_cdp" ||
      input.startupProfile === "tool_attach_browserbase"
    ) {
      if (!input.providedEndpoint) {
        throw new Error(
          `playwright_code startup profile "${input.startupProfile}" requires a providedEndpoint`,
        );
      }
      browser = await chromium.connectOverCDP(input.providedEndpoint.url, {
        headers: input.providedEndpoint.headers,
      });
      context = browser.contexts()[0] ?? (await browser.newContext());
      initialPage = context.pages()[0] ?? (await context.newPage());
    } else {
      throw new Error(
        `playwright_code does not support startup profile "${input.startupProfile}" yet`,
      );
    }

    const session = new PlaywrightSession(browser, context, initialPage);

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
