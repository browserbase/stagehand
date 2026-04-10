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
import { resolveLocalChromeExecutablePath } from "../targets/localChrome.js";
import {
  parseChromeDevtoolsListedPages,
  parseLooseJson,
  StdioMcpRuntime,
} from "./mcpUtils.js";

const DEFAULT_WAIT_TIMEOUT_MS = 15_000;

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

function buildSelectorResolver(selectorVar = "selector"): string {
  return `
    const selector = ${selectorVar};
    const toArray = (collection) => Array.isArray(collection) ? collection : Array.from(collection ?? []);
    const resolveElements = () => {
      if (selector.startsWith("xpath=")) {
        const expression = selector.slice("xpath=".length);
        const snapshot = document.evaluate(
          expression,
          document,
          null,
          XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
          null,
        );
        const elements = [];
        for (let i = 0; i < snapshot.snapshotLength; i += 1) {
          const item = snapshot.snapshotItem(i);
          if (item instanceof Element) {
            elements.push(item);
          }
        }
        return elements;
      }
      return toArray(document.querySelectorAll(selector)).filter(
        (item) => item instanceof Element,
      );
    };
    const elements = resolveElements();
    const first = elements[0] ?? null;
  `;
}

function keyName(key: string): string {
  return key === " " ? "Space" : key;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

class ChromeDevtoolsMcpLocatorHandle implements CoreLocatorHandle {
  constructor(
    private readonly pageHandle: ChromeDevtoolsMcpPageHandle,
    private readonly selector: string,
  ) {}

  async count(): Promise<number> {
    return this.pageHandle.evaluateSelector<number>(
      this.selector,
      "return elements.length;",
    );
  }

  async click(): Promise<void> {
    await this.pageHandle.click(this.selector);
  }

  async hover(): Promise<void> {
    await this.pageHandle.hover(this.selector);
  }

  async fill(value: string): Promise<void> {
    await this.pageHandle.fillSelector(this.selector, value);
  }

  async type(text: string): Promise<void> {
    await this.pageHandle.type(this.selector, text);
  }

  async isVisible(): Promise<boolean> {
    return this.pageHandle.evaluateSelector<boolean>(
      this.selector,
      `
        if (!first) return false;
        const rect = first.getBoundingClientRect();
        const style = window.getComputedStyle(first);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      `,
    );
  }

  async textContent(): Promise<string | null> {
    return this.pageHandle.evaluateSelector<string | null>(
      this.selector,
      "return first ? first.textContent : null;",
    );
  }

  async inputValue(): Promise<string> {
    return this.pageHandle.evaluateSelector<string>(
      this.selector,
      "return first && 'value' in first ? String(first.value ?? '') : '';",
    );
  }
}

class ChromeDevtoolsMcpPageHandle implements CorePageHandle {
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

  private async evaluateJson<R>(body: string): Promise<R> {
    const text = await this.runtime.callText("evaluate_script", {
      function: `() => { ${body} }`,
    });
    return parseLooseJson<R>(text);
  }

  async evaluateSelector<R>(selector: string, body: string): Promise<R> {
    return this.runtime.callJson<R>("evaluate_script", {
      function: `() => {
        ${buildSelectorResolver(serialize(selector))}
        ${body}
      }`,
    });
  }

  async fillSelector(selector: string, value: string): Promise<void> {
    await this.runtime.callTool("evaluate_script", {
      function: `() => {
        ${buildSelectorResolver(serialize(selector))}
        if (!first) throw new Error("Selector not found: ${escapeTemplateLiteral(selector)}");
        if (first instanceof HTMLElement) first.focus();
        if ("value" in first) {
          first.value = ${serialize(value)};
          first.dispatchEvent(new Event("input", { bubbles: true }));
          first.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          throw new Error("Selector is not fillable: ${escapeTemplateLiteral(selector)}");
        }
        return JSON.stringify(true);
      }`,
    });
  }

  private async refreshUrlFromPage(): Promise<void> {
    this.cachedUrl = await this.evaluateJson<string>(
      "return JSON.stringify(window.location.href);",
    );
  }

  async goto(
    url: string,
    opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number },
  ): Promise<void> {
    await this.runtime.callTool("navigate_page", {
      type: "url",
      url,
      ...(typeof opts?.timeoutMs === "number" ? { timeout: opts.timeoutMs } : {}),
    });
    this.cachedUrl = url;
  }

  async reload(
    opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number },
  ): Promise<void> {
    await this.runtime.callTool("navigate_page", {
      type: "reload",
      ...(typeof opts?.timeoutMs === "number" ? { timeout: opts.timeoutMs } : {}),
    });
    await this.refreshUrlFromPage();
  }

  async back(
    opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number },
  ): Promise<boolean> {
    await this.runtime.callTool("navigate_page", {
      type: "back",
      ...(typeof opts?.timeoutMs === "number" ? { timeout: opts.timeoutMs } : {}),
    });
    await this.refreshUrlFromPage();
    return true;
  }

  async forward(
    opts?: { waitUntil?: "load" | "domcontentloaded" | "networkidle"; timeoutMs?: number },
  ): Promise<boolean> {
    await this.runtime.callTool("navigate_page", {
      type: "forward",
      ...(typeof opts?.timeoutMs === "number" ? { timeout: opts.timeoutMs } : {}),
    });
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
    return this.evaluateJson<string>("return JSON.stringify(document.title);");
  }

  async evaluate<R = unknown, Arg = unknown>(
    pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    if (typeof pageFunctionOrExpression === "string") {
      const expression = escapeTemplateLiteral(pageFunctionOrExpression);
      return this.evaluateJson<R>(`
        const value = eval(\`${expression}\`);
        return JSON.stringify(value);
      `);
    }

    return this.runtime.callJson<R>("evaluate_script", {
      function: `() => {
        const fn = ${pageFunctionOrExpression.toString()};
        const arg = ${serialize(arg)};
        return Promise.resolve(fn(arg)).then((value) => JSON.stringify(value));
      }`,
    });
  }

  async screenshot(opts?: {
    fullPage?: boolean;
    type?: "png" | "jpeg";
    quality?: number;
  }): Promise<Buffer> {
    const extension = opts?.type === "jpeg" ? "jpg" : "png";
    const filename = `chrome-devtools-mcp-screenshot-${Date.now()}.${extension}`;
    await this.runtime.callTool("take_screenshot", {
      format: opts?.type ?? "png",
      fullPage: opts?.fullPage ?? false,
      filePath: filename,
      ...(typeof opts?.quality === "number" ? { quality: opts.quality } : {}),
    });
    return this.runtime.readArtifact(filename);
  }

  async setViewport(size: { width: number; height: number }): Promise<void> {
    await this.runtime.callTool("resize_page", size);
  }

  async setViewportSize(width: number, height: number): Promise<void> {
    await this.setViewport({ width, height });
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
        await this.waitForTimeout(spec.timeoutMs);
        return;
      case "load_state":
        if (spec.state === "networkidle") {
          await this.waitForTimeout(spec.timeoutMs ?? 500);
          return;
        }
        await this.runtime.callTool("evaluate_script", {
          function: `() => {
            return new Promise((resolve) => {
              if (document.readyState === ${serialize(spec.state === "domcontentloaded" ? "interactive" : "complete")} || document.readyState === "complete") {
                resolve(JSON.stringify(true));
                return;
              }
              window.addEventListener("load", () => resolve(JSON.stringify(true)), { once: true });
            });
          }`,
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
    const timeout = opts?.timeout ?? DEFAULT_WAIT_TIMEOUT_MS;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const result = await this.evaluateSelector<boolean>(
        selector,
        `
          const visible = first ? (() => {
            const rect = first.getBoundingClientRect();
            const style = window.getComputedStyle(first);
            return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
          })() : false;
          switch (${serialize(opts?.state ?? "visible")}) {
            case "attached":
              return JSON.stringify(Boolean(first));
            case "detached":
              return JSON.stringify(!first);
            case "hidden":
              return JSON.stringify(!first || !visible);
            case "visible":
            default:
              return JSON.stringify(Boolean(first) && visible);
          }
        `,
      );

      if (result) return true;
      await sleep(100);
    }

    throw new Error(`Timed out waiting for selector "${selector}"`);
  }

  async waitForTimeout(ms: number): Promise<void> {
    await sleep(ms);
  }

  locator(selector: string): CoreLocatorHandle {
    return new ChromeDevtoolsMcpLocatorHandle(this, selector);
  }

  private async dispatchPointerAtCoordinates(
    x: number,
    y: number,
    eventNames: string[],
  ): Promise<void> {
    await this.runtime.callTool("evaluate_script", {
      function: `() => {
        const target = document.elementFromPoint(${x}, ${y});
        if (!(target instanceof Element)) {
          throw new Error("No element found at coordinates");
        }
        const events = ${serialize(eventNames)};
        for (const name of events) {
          target.dispatchEvent(new MouseEvent(name, {
            bubbles: true,
            cancelable: true,
            clientX: ${x},
            clientY: ${y},
            view: window,
          }));
        }
        if (target instanceof HTMLElement) target.focus();
        return JSON.stringify(true);
      }`,
    });
  }

  async click(targetOrX: string | ActionTarget | number, y?: number): Promise<void> {
    if (typeof targetOrX === "number") {
      if (typeof y !== "number") {
        throw new Error("click(x, y) requires both numeric coordinates");
      }
      await this.dispatchPointerAtCoordinates(targetOrX, y, ["mousedown", "mouseup", "click"]);
      return;
    }

    const target =
      typeof targetOrX === "string"
        ? ({ kind: "selector", value: targetOrX } as const)
        : targetOrX;

    switch (target.kind) {
      case "selector":
        await this.runtime.callTool("evaluate_script", {
          function: `() => {
            ${buildSelectorResolver(serialize(target.value))}
            if (!first) throw new Error("Selector not found: ${escapeTemplateLiteral(target.value)}");
            if (first instanceof HTMLElement) first.focus();
            first.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
            first.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
            first.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
            if (typeof first.click === "function") first.click();
            return JSON.stringify(true);
          }`,
        });
        return;
      case "coords":
        await this.click(target.x, target.y);
        return;
      case "text":
        await this.runtime.callTool("wait_for", { text: [target.text] });
        await this.runtime.callTool("evaluate_script", {
          function: `() => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
            let match = null;
            while (walker.nextNode()) {
              const candidate = walker.currentNode;
              if (candidate instanceof HTMLElement && candidate.innerText?.includes(${serialize(target.text)})) {
                match = candidate;
                break;
              }
            }
            if (!match) throw new Error("Text target not found");
            match.focus?.();
            match.click?.();
            return JSON.stringify(true);
          }`,
        });
        return;
      case "role_name":
        await this.runtime.callTool("evaluate_script", {
          function: `() => {
            const role = ${serialize(target.role)};
            const name = ${serialize(target.name ?? "")};
            const candidates = Array.from(document.querySelectorAll('[role]')).filter(
              (node) => node.getAttribute('role') === role,
            );
            const match = candidates.find((node) => {
              const label = node.getAttribute('aria-label') || node.textContent || '';
              return !name || label.includes(name);
            });
            if (!(match instanceof HTMLElement)) throw new Error("Role target not found");
            match.focus();
            match.click();
            return JSON.stringify(true);
          }`,
        });
        return;
      default:
        throw new Error(
          `chrome_devtools_mcp does not support click target kind "${target.kind}" yet`,
        );
    }
  }

  async hover(targetOrX: string | ActionTarget | number, y?: number): Promise<void> {
    if (typeof targetOrX === "number") {
      if (typeof y !== "number") {
        throw new Error("hover(x, y) requires both numeric coordinates");
      }
      await this.dispatchPointerAtCoordinates(targetOrX, y, ["mousemove", "mouseover", "mouseenter"]);
      return;
    }

    const target =
      typeof targetOrX === "string"
        ? ({ kind: "selector", value: targetOrX } as const)
        : targetOrX;

    switch (target.kind) {
      case "selector":
        await this.runtime.callTool("evaluate_script", {
          function: `() => {
            ${buildSelectorResolver(serialize(target.value))}
            if (!first) throw new Error("Selector not found: ${escapeTemplateLiteral(target.value)}");
            for (const name of ["mousemove", "mouseover", "mouseenter"]) {
              first.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true, view: window }));
            }
            return JSON.stringify(true);
          }`,
        });
        return;
      case "coords":
        await this.hover(target.x, target.y);
        return;
      case "text":
      case "role_name":
        await this.click(target as ActionTarget);
        return;
      default:
        throw new Error(
          `chrome_devtools_mcp does not support hover target kind "${target.kind}" yet`,
        );
    }
  }

  async scroll(
    _x: number,
    _y: number,
    deltaX: number,
    deltaY: number,
  ): Promise<void> {
    await this.runtime.callTool("evaluate_script", {
      function: `() => {
        window.scrollBy(${deltaX}, ${deltaY});
        return JSON.stringify(window.scrollY);
      }`,
    });
  }

  async type(
    targetOrText: string | ActionTarget | { kind: "focused" },
    text?: string,
  ): Promise<void> {
    if (typeof targetOrText === "string" && typeof text === "undefined") {
      await this.runtime.callTool("type_text", {
        text: targetOrText,
      });
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
        await this.runtime.callTool("type_text", { text });
        return;
      case "selector":
        await this.fillSelector(target.value, text);
        return;
      case "coords":
        await this.click(target.x, target.y);
        await this.runtime.callTool("type_text", { text });
        return;
      case "text":
      case "role_name":
        await this.click(target as ActionTarget);
        await this.runtime.callTool("type_text", { text });
        return;
      default:
        throw new Error(`chrome_devtools_mcp does not support type target kind "${target.kind}" yet`);
    }
  }

  async press(
    targetOrKey: string | ActionTarget | { kind: "focused" },
    key?: string,
  ): Promise<void> {
    if (typeof targetOrKey === "string" && typeof key === "undefined") {
      await this.runtime.callTool("press_key", { key: keyName(targetOrKey) });
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
        await this.runtime.callTool("press_key", { key: keyName(key) });
        return;
      case "selector":
      case "coords":
      case "text":
      case "role_name":
        await this.click(target as ActionTarget);
        await this.runtime.callTool("press_key", { key: keyName(key) });
        return;
      default:
        throw new Error(`chrome_devtools_mcp does not support press target kind "${target.kind}" yet`);
    }
  }

  async represent(): Promise<PageRepresentation> {
    const filename = `chrome-devtools-mcp-snapshot-${Date.now()}.md`;
    await this.runtime.callTool("take_snapshot", { filePath: filename });
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

type TrackedChromePage = {
  id: string;
  toolPageId?: number;
  handle: ChromeDevtoolsMcpPageHandle;
};

class ChromeDevtoolsMcpSession implements CoreSession {
  private readonly pages = new Map<string, TrackedChromePage>();
  private pageCounter = 0;
  private activePageId: string | null = null;
  private closed = false;

  constructor(private readonly runtime: StdioMcpRuntime) {}

  private nextPageId(): string {
    this.pageCounter += 1;
    return `page-${this.pageCounter}`;
  }

  private findOrCreateTrackedPage(input: {
    toolPageId?: number;
    url: string;
  }): TrackedChromePage {
    const existing = [...this.pages.values()].find((page) => {
      return typeof input.toolPageId === "number" && page.toolPageId === input.toolPageId;
    });

    if (existing) {
      existing.handle.setCachedUrl(input.url);
      return existing;
    }

    const tracked: TrackedChromePage = {
      id: this.nextPageId(),
      toolPageId: input.toolPageId,
      handle: new ChromeDevtoolsMcpPageHandle(
        this.runtime,
        "",
        input.url,
      ),
    };
    tracked.handle = new ChromeDevtoolsMcpPageHandle(this.runtime, tracked.id, input.url);
    this.pages.set(tracked.id, tracked);
    return tracked;
  }

  private async syncPagesFromTool(): Promise<void> {
    const text = await this.runtime.callText("list_pages", {});
    const listed = parseChromeDevtoolsListedPages(text);
    if (!listed.length) {
      if (!this.pages.size) {
        const seeded = this.findOrCreateTrackedPage({ url: "about:blank" });
        this.activePageId = seeded.id;
      }
      return;
    }

    const seenIds = new Set<number>();
    for (const page of listed) {
      seenIds.add(page.toolPageId);
      this.findOrCreateTrackedPage(page);
    }

    for (const [id, tracked] of this.pages.entries()) {
      if (typeof tracked.toolPageId !== "number") continue;
      if (seenIds.has(tracked.toolPageId)) continue;
      this.pages.delete(id);
      if (this.activePageId === id) {
        this.activePageId = null;
      }
    }

    if (!this.activePageId) {
      const first = listed[0];
      this.activePageId = this.findOrCreateTrackedPage(first).id;
    }
  }

  async initialize(): Promise<void> {
    await this.syncPagesFromTool();
  }

  async listPages(): Promise<CorePageHandle[]> {
    await this.syncPagesFromTool();
    return [...this.pages.values()].map((tracked) => tracked.handle);
  }

  async activePage(): Promise<CorePageHandle> {
    await this.syncPagesFromTool();
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
    await this.runtime.callTool("new_page", {
      url: url ?? "about:blank",
    });
    const beforeIds = new Set(
      [...this.pages.values()]
        .map((page) => page.toolPageId)
        .filter((value): value is number => typeof value === "number"),
    );
    await this.syncPagesFromTool();
    const created =
      [...this.pages.values()].find((page) => {
        return typeof page.toolPageId === "number" && !beforeIds.has(page.toolPageId);
      }) ?? [...this.pages.values()].at(-1);

    if (!created) {
      throw new Error("new_page did not create a page");
    }

    this.activePageId = created.id;
    return created.handle;
  }

  async selectPage(pageId: string): Promise<void> {
    await this.syncPagesFromTool();
    const tracked = this.pages.get(pageId);
    if (!tracked || typeof tracked.toolPageId !== "number") {
      throw new Error(`Unknown page id "${pageId}"`);
    }
    await this.runtime.callTool("select_page", {
      pageId: tracked.toolPageId,
      bringToFront: true,
    });
    this.activePageId = pageId;
    tracked.handle.setCachedUrl(
      await tracked.handle.evaluate<string>("window.location.href"),
    );
  }

  async closePage(pageId: string): Promise<void> {
    await this.syncPagesFromTool();
    const tracked = this.pages.get(pageId);
    if (!tracked || typeof tracked.toolPageId !== "number") {
      throw new Error(`Unknown page id "${pageId}"`);
    }
    await this.runtime.callTool("close_page", {
      pageId: tracked.toolPageId,
    });
    this.pages.delete(pageId);
    if (this.activePageId === pageId) {
      this.activePageId = null;
    }
    await this.syncPagesFromTool();
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

function buildChromeDevtoolsMcpArgs(input: ToolStartInput): string[] {
  const args = [
    "dlx",
    "chrome-devtools-mcp@latest",
    "--no-usage-statistics",
    "--no-performance-crux",
  ];

  if (
    input.startupProfile === "runner_provided_local_cdp" ||
    input.startupProfile === "runner_provided_browserbase_cdp" ||
    input.startupProfile === "tool_attach_local_cdp" ||
    input.startupProfile === "tool_attach_browserbase"
  ) {
    if (!input.providedEndpoint) {
      throw new Error(
        `chrome_devtools_mcp startup profile "${input.startupProfile}" requires a providedEndpoint`,
      );
    }

    if (input.providedEndpoint.kind === "ws") {
      args.push("--wsEndpoint", input.providedEndpoint.url);
      if (input.providedEndpoint.headers) {
        args.push("--wsHeaders", JSON.stringify(input.providedEndpoint.headers));
      }
    } else {
      args.push("--browserUrl", input.providedEndpoint.url);
    }
  } else if (input.startupProfile === "tool_launch_local") {
    args.push("--headless", "--isolated");
    const executablePath = resolveLocalChromeExecutablePath();
    if (executablePath) {
      args.push("--executablePath", executablePath);
    }
    if (process.env.CI) {
      args.push("--chromeArg=--no-sandbox");
      args.push("--chromeArg=--disable-setuid-sandbox");
    }
  } else {
    throw new Error(
      `chrome_devtools_mcp does not support startup profile "${input.startupProfile}" yet`,
    );
  }

  return args;
}

export class ChromeDevtoolsMcpTool implements CoreTool {
  readonly id = "chrome_devtools_mcp";
  readonly surface = "mcp";
  readonly family = "chrome_devtools";
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
      args: buildChromeDevtoolsMcpArgs(input),
    });
    const session = new ChromeDevtoolsMcpSession(runtime);
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
