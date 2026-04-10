import { resolveLocalChromeExecutablePath } from "../targets/localChrome.js";
import type { PageRepresentation } from "../contracts/representation.js";
import type { Artifact, ConnectionMode } from "../contracts/results.js";
import type { ActionTarget, TargetKind, WaitSpec } from "../contracts/targets.js";
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
import { StdioMcpRuntime } from "./mcpUtils.js";

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

type ListedPlaywrightPage = {
  index: number;
  url: string;
};

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

function serialize(value: unknown): string {
  return JSON.stringify(value);
}

function escapeTemplateLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("`", "\\`");
}

function selectorExpression(selector: string): string {
  return serialize(selector);
}

function actionTargetExpression(target: ActionTarget): string {
  return serialize(target);
}

function buildPlaywrightSelectorResolver(selectorVar = "selector"): string {
  return `
    const selector = ${selectorVar};
    if (selector.startsWith("xpath=")) {
      return page.locator(selector);
    }
    return page.locator(selector);
  `;
}

class PlaywrightMcpLocatorHandle implements CoreLocatorHandle {
  constructor(
    private readonly pageHandle: PlaywrightMcpPageHandle,
    private readonly selector: string,
  ) {}

  async count(): Promise<number> {
    return this.pageHandle.runCodeJson<number>(`
      async (page) => {
        const selector = ${selectorExpression(this.selector)};
        ${buildPlaywrightSelectorResolver("selector")}
        return await page.locator(selector).count();
      }
    `);
  }

  async click(): Promise<void> {
    await this.pageHandle.click(this.selector);
  }

  async hover(): Promise<void> {
    await this.pageHandle.hover(this.selector);
  }

  async fill(value: string): Promise<void> {
    await this.pageHandle.runCode(`
      async (page) => {
        const selector = ${selectorExpression(this.selector)};
        await page.locator(selector).fill(${serialize(value)});
      }
    `);
  }

  async type(text: string, opts?: { delay?: number }): Promise<void> {
    await this.pageHandle.runCode(`
      async (page) => {
        const selector = ${selectorExpression(this.selector)};
        await page.locator(selector).type(${serialize(text)}, ${serialize(opts ?? {})});
      }
    `);
  }

  async isVisible(): Promise<boolean> {
    return this.pageHandle.runCodeJson<boolean>(`
      async (page) => {
        const selector = ${selectorExpression(this.selector)};
        return await page.locator(selector).isVisible();
      }
    `);
  }

  async textContent(): Promise<string | null> {
    return this.pageHandle.runCodeJson<string | null>(`
      async (page) => {
        const selector = ${selectorExpression(this.selector)};
        return await page.locator(selector).textContent();
      }
    `);
  }

  async inputValue(): Promise<string> {
    return this.pageHandle.runCodeJson<string>(`
      async (page) => {
        const selector = ${selectorExpression(this.selector)};
        return await page.locator(selector).inputValue();
      }
    `);
  }
}

class PlaywrightMcpPageHandle implements CorePageHandle {
  constructor(
    private readonly runtime: StdioMcpRuntime,
    readonly id: string,
    private cachedUrl = "about:blank",
  ) {}

  setCachedUrl(url: string): void {
    this.cachedUrl = url;
  }

  url(): string {
    return this.cachedUrl;
  }

  async runCode(code: string): Promise<string> {
    const text = await this.runtime.callText("browser_run_code", {
      code,
    });
    return text;
  }

  async runCodeJson<T>(code: string): Promise<T> {
    return this.runtime.callJson<T>("browser_run_code", {
      code,
    });
  }

  private async refreshUrlFromPage(): Promise<void> {
    this.cachedUrl = await this.runCodeJson<string>(`
      async (page) => JSON.stringify(page.url())
    `);
  }

  async goto(
    url: string,
    _opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number },
  ): Promise<void> {
    await this.runtime.callTool("browser_navigate", { url });
    this.cachedUrl = url;
  }

  async reload(
    _opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number },
  ): Promise<void> {
    await this.runCode(`
      async (page) => {
        await page.reload();
        return JSON.stringify(page.url());
      }
    `);
    await this.refreshUrlFromPage();
  }

  async back(
    _opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number },
  ): Promise<boolean> {
    await this.runtime.callTool("browser_navigate_back", {});
    await this.refreshUrlFromPage();
    return true;
  }

  async forward(
    _opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number },
  ): Promise<boolean> {
    await this.runCode(`
      async (page) => {
        await page.goForward();
        return JSON.stringify(page.url());
      }
    `);
    await this.refreshUrlFromPage();
    return true;
  }

  async goBack(
    opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number },
  ): Promise<boolean> {
    return this.back(opts);
  }

  async goForward(
    opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number },
  ): Promise<boolean> {
    return this.forward(opts);
  }

  async title(): Promise<string> {
    return this.runCodeJson<string>(`
      async (page) => JSON.stringify(await page.title())
    `);
  }

  async evaluate<R = unknown, Arg = unknown>(
    pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    if (typeof pageFunctionOrExpression === "string") {
      const expression = escapeTemplateLiteral(pageFunctionOrExpression);
      return this.runCodeJson<R>(`
        async (page) => {
          const value = await page.evaluate(() => {
            return eval(\`${expression}\`);
          });
          return JSON.stringify(value);
        }
      `);
    }

    return this.runCodeJson<R>(`
      async (page) => {
        const fn = ${pageFunctionOrExpression.toString()};
        const arg = ${serialize(arg)};
        const value = await page.evaluate(fn, arg);
        return JSON.stringify(value);
      }
    `);
  }

  async screenshot(opts?: {
    fullPage?: boolean;
    type?: "png" | "jpeg";
    quality?: number;
  }): Promise<Buffer> {
    const extension = opts?.type === "jpeg" ? "jpg" : "png";
    const filename = `playwright-mcp-screenshot-${Date.now()}.${extension}`;
    await this.runtime.callTool("browser_take_screenshot", {
      type: opts?.type ?? "png",
      fullPage: opts?.fullPage ?? false,
      filename,
      ...(typeof opts?.quality === "number" ? { quality: opts.quality } : {}),
    });
    return this.runtime.readArtifact(filename);
  }

  async setViewport(size: { width: number; height: number }): Promise<void> {
    await this.runtime.callTool("browser_resize", size);
  }

  async setViewportSize(width: number, height: number): Promise<void> {
    await this.setViewport({ width, height });
  }

  async wait(spec: WaitSpec): Promise<void> {
    switch (spec.kind) {
      case "selector":
        await this.runCode(`
          async (page) => {
            await page.waitForSelector(${selectorExpression(spec.selector)}, ${serialize({
              timeout: spec.timeoutMs,
              state: spec.state,
            })});
            return JSON.stringify(true);
          }
        `);
        return;
      case "timeout":
        await this.waitForTimeout(spec.timeoutMs);
        return;
      case "load_state":
        await this.runCode(`
          async (page) => {
            await page.waitForLoadState(${serialize(spec.state)}, ${serialize({
              timeout: spec.timeoutMs,
            })});
            return JSON.stringify(true);
          }
        `);
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
    await this.runCode(`
      async (page) => {
        await page.waitForSelector(${selectorExpression(selector)}, ${serialize(opts ?? {})});
        return JSON.stringify(true);
      }
    `);
    return true;
  }

  async waitForTimeout(ms: number): Promise<void> {
    await this.runtime.callTool("browser_wait_for", {
      time: ms / 1000,
    });
  }

  locator(selector: string): CoreLocatorHandle {
    return new PlaywrightMcpLocatorHandle(this, selector);
  }

  private async performTargetedAction(
    target: string | ActionTarget,
    action: "click" | "hover",
  ): Promise<void> {
    const normalized =
      typeof target === "string"
        ? ({ kind: "selector", value: target } as const)
        : target;

    switch (normalized.kind) {
      case "selector":
        await this.runCode(`
          async (page) => {
            await page.locator(${selectorExpression(normalized.value)})[${serialize(action)}]();
          }
        `);
        return;
      case "coords":
        await this.runCode(`
          async (page) => {
            await page.mouse.${action === "click" ? "click" : "move"}(${normalized.x}, ${normalized.y});
          }
        `);
        return;
      case "role_name":
        await this.runCode(`
          async (page) => {
            const target = ${actionTargetExpression(normalized)};
            const locator = page.getByRole(target.role, { name: target.name });
            await locator.${action}();
          }
        `);
        return;
      case "text":
        await this.runCode(`
          async (page) => {
            const target = ${actionTargetExpression(normalized)};
            const locator = page.getByText(target.text);
            await locator.${action}();
          }
        `);
        return;
      default:
        throw new Error(
          `playwright_mcp does not support ${action} target kind "${normalized.kind}" yet`,
        );
    }
  }

  async click(targetOrX: string | ActionTarget | number, y?: number): Promise<void> {
    if (typeof targetOrX === "number") {
      if (typeof y !== "number") {
        throw new Error("click(x, y) requires both numeric coordinates");
      }
      await this.runCode(`
        async (page) => {
          await page.mouse.click(${targetOrX}, ${y});
        }
      `);
      return;
    }

    await this.performTargetedAction(targetOrX, "click");
  }

  async hover(targetOrX: string | ActionTarget | number, y?: number): Promise<void> {
    if (typeof targetOrX === "number") {
      if (typeof y !== "number") {
        throw new Error("hover(x, y) requires both numeric coordinates");
      }
      await this.runCode(`
        async (page) => {
          await page.mouse.move(${targetOrX}, ${y});
        }
      `);
      return;
    }

    await this.performTargetedAction(targetOrX, "hover");
  }

  async scroll(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
  ): Promise<void> {
    await this.runCode(`
      async (page) => {
        await page.mouse.move(${x}, ${y});
        await page.mouse.wheel(${deltaX}, ${deltaY});
      }
    `);
  }

  async type(
    targetOrText: string | ActionTarget | { kind: "focused" },
    text?: string,
  ): Promise<void> {
    if (typeof targetOrText === "string" && typeof text === "undefined") {
      await this.runtime.callTool("browser_press_key", { key: targetOrText });
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
        await this.runtime.callTool("browser_press_key", { key: text });
        return;
      case "selector":
        await this.runCode(`
          async (page) => {
            const locator = page.locator(${selectorExpression(target.value)});
            await locator.fill(${serialize(text)});
          }
        `);
        return;
      case "coords":
        await this.runCode(`
          async (page) => {
            await page.mouse.click(${target.x}, ${target.y});
            await page.keyboard.type(${serialize(text)});
          }
        `);
        return;
      case "role_name":
        await this.runCode(`
          async (page) => {
            const target = ${actionTargetExpression(target)};
            await page.getByRole(target.role, { name: target.name }).fill(${serialize(text)});
          }
        `);
        return;
      case "text":
        await this.runCode(`
          async (page) => {
            const target = ${actionTargetExpression(target)};
            await page.getByText(target.text).click();
            await page.keyboard.type(${serialize(text)});
          }
        `);
        return;
      default:
        throw new Error(`playwright_mcp does not support type target kind "${target.kind}" yet`);
    }
  }

  async press(
    targetOrKey: string | ActionTarget | { kind: "focused" },
    key?: string,
  ): Promise<void> {
    if (typeof targetOrKey === "string" && typeof key === "undefined") {
      await this.runtime.callTool("browser_press_key", { key: targetOrKey });
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
        await this.runtime.callTool("browser_press_key", { key });
        return;
      case "selector":
        await this.runCode(`
          async (page) => {
            await page.locator(${selectorExpression(target.value)}).click();
            await page.keyboard.press(${serialize(key)});
          }
        `);
        return;
      case "coords":
        await this.runCode(`
          async (page) => {
            await page.mouse.click(${target.x}, ${target.y});
            await page.keyboard.press(${serialize(key)});
          }
        `);
        return;
      case "role_name":
        await this.runCode(`
          async (page) => {
            const target = ${actionTargetExpression(target)};
            await page.getByRole(target.role, { name: target.name }).click();
            await page.keyboard.press(${serialize(key)});
          }
        `);
        return;
      case "text":
        await this.runCode(`
          async (page) => {
            const target = ${actionTargetExpression(target)};
            await page.getByText(target.text).click();
            await page.keyboard.press(${serialize(key)});
          }
        `);
        return;
      default:
        throw new Error(`playwright_mcp does not support press target kind "${target.kind}" yet`);
    }
  }

  async represent(): Promise<PageRepresentation> {
    const filename = `playwright-mcp-snapshot-${Date.now()}.md`;
    await this.runtime.callTool("browser_snapshot", { filename });
    const content = await this.runtime.readArtifactText(filename);

    return {
      kind: "snapshot_refs",
      content,
      metadata: {
        bytes: Buffer.byteLength(content, "utf8"),
        tokenEstimate: Math.ceil(content.length / 4),
      },
    };
  }
}

type TrackedPlaywrightPage = {
  id: string;
  index: number;
  handle: PlaywrightMcpPageHandle;
};

class PlaywrightMcpSession implements CoreSession {
  private readonly pages = new Map<string, TrackedPlaywrightPage>();
  private readonly pagesByIndex = new Map<number, TrackedPlaywrightPage>();
  private pageCounter = 0;
  private activePageId: string | null = null;
  private closed = false;

  constructor(private readonly runtime: StdioMcpRuntime) {}

  private nextPageId(): string {
    this.pageCounter += 1;
    return `page-${this.pageCounter}`;
  }

  private findOrCreatePage(index: number, url: string): TrackedPlaywrightPage {
    const existing = this.pagesByIndex.get(index);
    if (existing) {
      existing.handle.setCachedUrl(url);
      return existing;
    }

    const tracked: TrackedPlaywrightPage = {
      id: this.nextPageId(),
      index,
      handle: new PlaywrightMcpPageHandle(this.runtime, "", url),
    };
    tracked.handle = new PlaywrightMcpPageHandle(this.runtime, tracked.id, url);
    this.pages.set(tracked.id, tracked);
    this.pagesByIndex.set(index, tracked);
    return tracked;
  }

  private async syncPages(): Promise<void> {
    const listed = await this.runtime.callJson<ListedPlaywrightPage[]>("browser_run_code", {
      code: `
        async (page) => {
          const pages = page.context().pages().map((candidate, index) => ({
            index,
            url: candidate.url(),
          }));
          return JSON.stringify(pages);
        }
      `,
    });

    const seenIndexes = new Set<number>();
    for (const item of listed) {
      seenIndexes.add(item.index);
      this.findOrCreatePage(item.index, item.url);
    }

    for (const [index, tracked] of this.pagesByIndex.entries()) {
      if (seenIndexes.has(index)) continue;
      this.pagesByIndex.delete(index);
      this.pages.delete(tracked.id);
      if (this.activePageId === tracked.id) {
        this.activePageId = null;
      }
    }

    if (!this.activePageId && listed[0]) {
      this.activePageId = this.findOrCreatePage(listed[0].index, listed[0].url).id;
    }
  }

  async initialize(): Promise<void> {
    await this.syncPages();
  }

  async listPages(): Promise<CorePageHandle[]> {
    await this.syncPages();
    return [...this.pagesByIndex.values()]
      .sort((left, right) => left.index - right.index)
      .map((tracked) => tracked.handle);
  }

  async activePage(): Promise<CorePageHandle> {
    await this.syncPages();
    if (!this.activePageId) {
      throw new Error("No active page available");
    }
    const active = this.pages.get(this.activePageId);
    if (!active) {
      throw new Error(`Unknown active page "${this.activePageId}"`);
    }
    return active.handle;
  }

  async newPage(url?: string): Promise<CorePageHandle> {
    await this.runtime.callTool("browser_tabs", { action: "new" });
    await this.syncPages();

    const pages = [...this.pagesByIndex.values()].sort((left, right) => left.index - right.index);
    const created = pages[pages.length - 1];
    if (!created) {
      throw new Error("browser_tabs(new) did not create a page");
    }

    this.activePageId = created.id;
    if (url) {
      await created.handle.goto(url);
    }
    return created.handle;
  }

  async selectPage(pageId: string): Promise<void> {
    await this.syncPages();
    const tracked = this.pages.get(pageId);
    if (!tracked) {
      throw new Error(`Unknown page id "${pageId}"`);
    }

    await this.runtime.callTool("browser_tabs", {
      action: "select",
      index: tracked.index,
    });
    this.activePageId = pageId;
    await tracked.handle.evaluate("window.location.href");
    tracked.handle.setCachedUrl(
      await this.runtime.callJson<string>("browser_run_code", {
        code: `
          async (page) => JSON.stringify(page.url())
        `,
      }),
    );
  }

  async closePage(pageId: string): Promise<void> {
    await this.syncPages();
    const tracked = this.pages.get(pageId);
    if (!tracked) {
      throw new Error(`Unknown page id "${pageId}"`);
    }
    await this.runtime.callTool("browser_tabs", {
      action: "close",
      index: tracked.index,
    });
    this.pages.delete(pageId);
    this.pagesByIndex.delete(tracked.index);
    if (this.activePageId === pageId) {
      this.activePageId = null;
    }
    await this.syncPages();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.runtime.close();
  }

  async getArtifacts(): Promise<Artifact[]> {
    return [];
  }

  async getRawMetrics(): Promise<Record<string, unknown>> {
    const pages = await this.listPages();
    return {
      pageCount: pages.length,
    };
  }
}

function buildPlaywrightMcpArgs(input: ToolStartInput): string[] {
  const args = ["dlx", "@playwright/mcp@latest"];

  if (
    input.startupProfile === "runner_provided_local_cdp" ||
    input.startupProfile === "runner_provided_browserbase_cdp" ||
    input.startupProfile === "tool_attach_local_cdp" ||
    input.startupProfile === "tool_attach_browserbase"
  ) {
    if (!input.providedEndpoint) {
      throw new Error(
        `playwright_mcp startup profile "${input.startupProfile}" requires a providedEndpoint`,
      );
    }

    args.push("--cdp-endpoint", input.providedEndpoint.url);
    for (const [key, value] of Object.entries(input.providedEndpoint.headers ?? {})) {
      args.push("--cdp-header", `${key}:${value}`);
    }
  } else if (input.startupProfile === "tool_launch_local") {
    args.push("--headless", "--browser", "chrome", "--isolated");
    const executablePath = resolveLocalChromeExecutablePath();
    if (executablePath) {
      args.push("--executable-path", executablePath);
    }
    if (process.env.CI) {
      args.push("--no-sandbox");
    }
  } else {
    throw new Error(
      `playwright_mcp does not support startup profile "${input.startupProfile}" yet`,
    );
  }

  return args;
}

export class PlaywrightMcpTool implements CoreTool {
  readonly id = "playwright_mcp";
  readonly surface = "mcp";
  readonly family = "playwright";
  readonly supportedStartupProfiles: StartupProfile[] = [
    "tool_launch_local",
    "runner_provided_local_cdp",
    "runner_provided_browserbase_cdp",
    "tool_attach_local_cdp",
    "tool_attach_browserbase",
  ];
  readonly supportedCapabilities: CoreCapability[] = [...SUPPORTED_CAPABILITIES];
  readonly supportedTargetKinds: TargetKind[] = [
    "selector",
    "coords",
    "focused",
    "role_name",
    "text",
  ];

  async start(input: ToolStartInput): Promise<ToolStartResult> {
    const runtime = await StdioMcpRuntime.connect({
      command: "pnpm",
      args: buildPlaywrightMcpArgs(input),
    });
    const session = new PlaywrightMcpSession(runtime);
    await session.initialize();

    return {
      session,
      cleanup: async () => {
        await session.close();
      },
      metadata: {
        environment: input.environment === "BROWSERBASE" ? "browserbase" : "local",
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
