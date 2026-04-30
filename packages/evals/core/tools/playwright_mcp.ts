import { resolveLocalChromeExecutablePath } from "../targets/localChrome.js";
import type { PageRepresentation } from "../contracts/representation.js";
import type { Artifact, ConnectionMode } from "../contracts/results.js";
import type {
  ActionTarget,
  TargetKind,
  WaitSpec,
} from "../contracts/targets.js";
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
import {
  extractMcpImage,
  resolvePnpmCommand,
  StdioMcpRuntime,
} from "./mcpUtils.js";

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
  current: boolean;
};

type PlaywrightSnapshotEntry = {
  ref: string;
  role?: string;
  name?: string;
  text?: string;
};

type PlaywrightSnapshotQuery = {
  role?: string;
  name?: string;
  text?: string;
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

function historyWaitUntil(
  waitUntil?: "load" | "domcontentloaded" | "networkidle",
): "load" | "domcontentloaded" | "networkidle" {
  return waitUntil ?? "domcontentloaded";
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

function normalizeText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

function parsePlaywrightListedPages(text: string): ListedPlaywrightPage[] {
  const pages: ListedPlaywrightPage[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(
      /^\s*-\s*(\d+):\s*(\(current\)\s*)?\[[^\]]*]\(([^)]+)\)/,
    );
    if (!match) continue;
    pages.push({
      index: Number(match[1]),
      current: Boolean(match[2]),
      url: match[3],
    });
  }

  return pages.sort((left, right) => left.index - right.index);
}

function parsePlaywrightSnapshotEntries(
  text: string,
): PlaywrightSnapshotEntry[] {
  const entries: PlaywrightSnapshotEntry[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const refMatch = line.match(/\[ref=([^\]]+)\]/);
    if (!refMatch) continue;

    const withoutPrefix = line.replace(/^\s*-\s*/, "");
    const beforeRef = withoutPrefix.replace(/\s*\[ref=[^\]]+\]/, "").trim();
    const [content, trailingText] = beforeRef.split(/\s*:\s*/, 2);

    let role: string | undefined;
    let name: string | undefined;
    const quotedMatch = content.match(/^([a-zA-Z0-9_-]+)\s+"([^"]+)"/);
    if (quotedMatch) {
      role = quotedMatch[1];
      name = quotedMatch[2];
    } else {
      const roleMatch = content.match(/^([a-zA-Z0-9_-]+)/);
      role = roleMatch?.[1] ?? "";
    }

    entries.push({
      ref: refMatch[1],
      role: role || undefined,
      name: name || undefined,
      text: trailingText?.trim() || undefined,
    });
  }

  return entries;
}

function scorePlaywrightSnapshotEntry(
  entry: PlaywrightSnapshotEntry,
  query: PlaywrightSnapshotQuery,
): number {
  let score = 0;

  if (query.role) {
    if (normalizeText(entry.role) !== normalizeText(query.role)) {
      return -1;
    }
    score += 3;
  }

  if (query.name) {
    const expected = normalizeText(query.name);
    const candidates = [entry.name, entry.text]
      .map(normalizeText)
      .filter(Boolean);
    if (!candidates.length) {
      return -1;
    }
    if (candidates.includes(expected)) {
      score += 6;
    } else if (candidates.some((candidate) => candidate.includes(expected))) {
      score += 4;
    } else {
      return -1;
    }
  }

  if (query.text) {
    const expected = normalizeText(query.text);
    const candidates = [entry.text, entry.name]
      .map(normalizeText)
      .filter(Boolean);
    if (!candidates.length) {
      return -1;
    }
    if (candidates.includes(expected)) {
      score += 6;
    } else if (candidates.some((candidate) => candidate.includes(expected))) {
      score += 4;
    } else {
      return -1;
    }
  }

  return score;
}

function findBestPlaywrightSnapshotEntry(
  entries: PlaywrightSnapshotEntry[],
  query: PlaywrightSnapshotQuery,
): PlaywrightSnapshotEntry | null {
  let bestEntry: PlaywrightSnapshotEntry | null = null;
  let bestScore = -1;

  for (const entry of entries) {
    const score = scorePlaywrightSnapshotEntry(entry, query);
    if (score > bestScore) {
      bestEntry = entry;
      bestScore = score;
    }
  }

  return bestScore >= 0 ? bestEntry : null;
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

  private async snapshotText(): Promise<string> {
    return this.runtime.callText("browser_snapshot", {});
  }

  private async describeSelectorTarget(
    selector: string,
  ): Promise<PlaywrightSnapshotQuery> {
    return this.runCodeJson<PlaywrightSnapshotQuery>(`
      async (page) => {
        const selector = ${selectorExpression(selector)};
        const locator = page.locator(selector).first();
        await locator.waitFor({ state: "attached" });
        const description = await locator.evaluate((node) => {
          const read = (value) => typeof value === "string" ? value.trim() : "";
          const roleFromTag = () => {
            if (node instanceof HTMLButtonElement) return "button";
            if (node instanceof HTMLAnchorElement && node.href) return "link";
            if (node instanceof HTMLTextAreaElement) return "textbox";
            if (node instanceof HTMLSelectElement) return "combobox";
            if (node instanceof HTMLInputElement) {
              const type = read(node.type).toLowerCase();
              if (!type || ["text", "search", "email", "url", "tel", "password", "number"].includes(type)) {
                return "textbox";
              }
              if (type === "checkbox") return "checkbox";
              if (type === "radio") return "radio";
              if (type === "button" || type === "submit" || type === "reset") return "button";
            }
            const tagName = read(node.nodeName).toLowerCase();
            return tagName || "";
          };

          const textContent = node instanceof HTMLElement
            ? read(node.innerText) || read(node.textContent)
            : read(node.textContent);
          const valueText =
            node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
              ? read(node.value) || read(node.placeholder)
              : "";
          const description = {
            role: read(node.getAttribute?.("role")) || roleFromTag() || undefined,
            name:
              read(node.getAttribute?.("aria-label")) ||
              read(node.getAttribute?.("title")) ||
              valueText ||
              textContent ||
              undefined,
            text: textContent || valueText || undefined,
          };

          return JSON.stringify(description);
        });

        return JSON.stringify(description);
      }
    `);
  }

  private async resolveTargetRef(
    target:
      | string
      | Extract<ActionTarget, { kind: "selector" | "role_name" | "text" }>,
  ): Promise<string> {
    const query =
      typeof target === "string"
        ? await this.describeSelectorTarget(target)
        : target.kind === "selector"
          ? await this.describeSelectorTarget(target.value)
          : target.kind === "role_name"
            ? { role: target.role, name: target.name }
            : { text: target.text };

    const entries = parsePlaywrightSnapshotEntries(await this.snapshotText());
    const match = findBestPlaywrightSnapshotEntry(entries, query);
    if (!match) {
      throw new Error(
        `Unable to resolve Playwright MCP target from snapshot: ${JSON.stringify(query)}`,
      );
    }

    return match.ref;
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

  private async waitForHistoryNavigation(
    previousUrl: string,
    opts?: {
      waitUntil?: "load" | "domcontentloaded" | "networkidle";
      timeoutMs?: number;
    },
  ): Promise<boolean> {
    const deadline = Date.now() + (opts?.timeoutMs ?? 30_000);
    while (Date.now() < deadline) {
      await this.refreshUrlFromPage();
      if (this.cachedUrl !== previousUrl) {
        const desiredState = historyWaitUntil(opts?.waitUntil);
        while (Date.now() < deadline) {
          const readyState = await this.runCodeJson<
            "loading" | "interactive" | "complete"
          >(`
            async (page) => JSON.stringify(await page.evaluate(() => document.readyState))
          `);
          if (
            desiredState === "domcontentloaded"
              ? readyState !== "loading"
              : readyState === "complete"
          ) {
            return true;
          }
          await this.waitForTimeout(100);
        }
        break;
      }
      await this.waitForTimeout(100);
    }

    return false;
  }

  private async refreshUrlFromPage(): Promise<void> {
    this.cachedUrl = await this.runCodeJson<string>(`
      async (page) => JSON.stringify(page.url())
    `);
  }

  async goto(
    url: string,
    opts?: {
      waitUntil?: "load" | "domcontentloaded" | "networkidle";
      timeoutMs?: number;
    },
  ): Promise<void> {
    void opts;
    await this.runtime.callTool("browser_navigate", { url });
    this.cachedUrl = url;
  }

  async reload(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<void> {
    void opts;
    await this.runCode(`
      async (page) => {
        await page.reload();
        return JSON.stringify(page.url());
      }
    `);
    await this.refreshUrlFromPage();
  }

  async back(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<boolean> {
    const previousUrl = this.cachedUrl;
    await this.runCode(`
      async (page) => {
        await page.evaluate(() => history.back());
        return JSON.stringify(true);
      }
    `);
    return this.waitForHistoryNavigation(previousUrl, opts);
  }

  async forward(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<boolean> {
    const previousUrl = this.cachedUrl;
    await this.runCode(`
      async (page) => {
        await page.evaluate(() => history.forward());
        return JSON.stringify(true);
      }
    `);
    return this.waitForHistoryNavigation(previousUrl, opts);
  }

  async goBack(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<boolean> {
    return this.back(opts);
  }

  async goForward(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<boolean> {
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
    const result = await this.runtime.callTool("browser_take_screenshot", {
      type: opts?.type ?? "png",
      fullPage: opts?.fullPage ?? false,
      ...(typeof opts?.quality === "number" ? { quality: opts.quality } : {}),
    });
    const image = extractMcpImage(result);
    if (!image) {
      throw new Error("playwright_mcp screenshot did not return image content");
    }
    return Buffer.from(image.data, "base64");
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
            await page.waitForSelector(${selectorExpression(spec.selector)}, ${serialize(
              {
                timeout: spec.timeoutMs,
                state: spec.state,
              },
            )});
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
        await this.runtime.callTool(
          action === "click" ? "browser_click" : "browser_hover",
          { ref: await this.resolveTargetRef(normalized.value) },
        );
        return;
      case "coords":
        await this.runCode(`
          async (page) => {
            await page.mouse.${action === "click" ? "click" : "move"}(${normalized.x}, ${normalized.y});
          }
        `);
        return;
      case "role_name":
        await this.runtime.callTool(
          action === "click" ? "browser_click" : "browser_hover",
          { ref: await this.resolveTargetRef(normalized) },
        );
        return;
      case "text":
        await this.runtime.callTool(
          action === "click" ? "browser_click" : "browser_hover",
          { ref: await this.resolveTargetRef(normalized) },
        );
        return;
      default:
        throw new Error(
          `playwright_mcp does not support ${action} target kind "${normalized.kind}" yet`,
        );
    }
  }

  async click(
    targetOrX: string | ActionTarget | number,
    y?: number,
  ): Promise<void> {
    if (typeof targetOrX === "number") {
      if (typeof y !== "number") {
        throw new Error("click(x, y) requires both numeric coordinates");
      }
      await this.runCode(`
        async (page) => {
          await page.mouse.move(${targetOrX}, ${y});
          await page.mouse.down();
          await page.mouse.up();
        }
      `);
      return;
    }

    await this.performTargetedAction(targetOrX, "click");
  }

  async hover(
    targetOrX: string | ActionTarget | number,
    y?: number,
  ): Promise<void> {
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
        await this.runCode(`
          async (page) => {
            await page.keyboard.type(${serialize(text)});
          }
        `);
        return;
      case "selector":
        await this.runtime.callTool("browser_type", {
          ref: await this.resolveTargetRef(target.value),
          text,
        });
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
        await this.runtime.callTool("browser_type", {
          ref: await this.resolveTargetRef(target),
          text,
        });
        return;
      case "text":
        await this.runtime.callTool("browser_type", {
          ref: await this.resolveTargetRef(target),
          text,
        });
        return;
      default:
        throw new Error(
          `playwright_mcp does not support type target kind "${target.kind}" yet`,
        );
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
        await this.runtime.callTool("browser_click", {
          ref: await this.resolveTargetRef(target.value),
        });
        await this.runtime.callTool("browser_press_key", { key });
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
        await this.runtime.callTool("browser_click", {
          ref: await this.resolveTargetRef(target),
        });
        await this.runtime.callTool("browser_press_key", { key });
        return;
      case "text":
        await this.runtime.callTool("browser_click", {
          ref: await this.resolveTargetRef(target),
        });
        await this.runtime.callTool("browser_press_key", { key });
        return;
      default:
        throw new Error(
          `playwright_mcp does not support press target kind "${target.kind}" yet`,
        );
    }
  }

  async represent(): Promise<PageRepresentation> {
    const content = await this.snapshotText();

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
    const listed = parsePlaywrightListedPages(
      await this.runtime.callText("browser_tabs", { action: "list" }),
    );

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

    const current = listed.find((page) => page.current);
    if (current) {
      this.activePageId = this.findOrCreatePage(current.index, current.url).id;
      return;
    }

    if (!this.activePageId && listed[0]) {
      this.activePageId = this.findOrCreatePage(
        listed[0].index,
        listed[0].url,
      ).id;
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

    const pages = [...this.pagesByIndex.values()].sort(
      (left, right) => left.index - right.index,
    );
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
    await this.syncPages();
    this.activePageId = pageId;
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
    for (const [key, value] of Object.entries(
      input.providedEndpoint.headers ?? {},
    )) {
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
    const runtime = await StdioMcpRuntime.connect({
      command: resolvePnpmCommand(),
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
