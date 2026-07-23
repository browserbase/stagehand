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
import { resolveLocalChromeExecutablePath } from "../targets/localChrome.js";
import {
  parseChromeDevtoolsListedPages,
  parseLooseJson,
  resolvePnpmCommand,
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

type ChromeDevtoolsSnapshotEntry = {
  uid: string;
  role?: string;
  name?: string;
  text?: string;
};

type ChromeDevtoolsSnapshotQuery = {
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

function normalizeText(value: string | undefined): string {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

function parseChromeDevtoolsSnapshotEntries(
  text: string,
): ChromeDevtoolsSnapshotEntry[] {
  const entries: ChromeDevtoolsSnapshotEntry[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/uid=([^\s]+)\s+(.+)$/);
    if (!match) continue;

    const content = match[2].trim();
    const quotedMatch = content.match(/^([A-Za-z0-9_-]+)\s+"([^"]+)"/);
    const roleMatch = content.match(/^([A-Za-z0-9_-]+)/);
    const trailingText = quotedMatch
      ? content.slice(quotedMatch[0].length).trim()
      : content.slice((roleMatch?.[0] ?? "").length).trim();

    entries.push({
      uid: match[1],
      role: quotedMatch?.[1] ?? roleMatch?.[1] ?? undefined,
      name: quotedMatch?.[2] ?? undefined,
      text: trailingText || undefined,
    });
  }

  return entries;
}

function scoreChromeDevtoolsSnapshotEntry(
  entry: ChromeDevtoolsSnapshotEntry,
  query: ChromeDevtoolsSnapshotQuery,
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

function findBestChromeDevtoolsSnapshotEntry(
  entries: ChromeDevtoolsSnapshotEntry[],
  query: ChromeDevtoolsSnapshotQuery,
): ChromeDevtoolsSnapshotEntry | null {
  let bestEntry: ChromeDevtoolsSnapshotEntry | null = null;
  let bestScore = -1;

  for (const entry of entries) {
    const score = scoreChromeDevtoolsSnapshotEntry(entry, query);
    if (score > bestScore) {
      bestEntry = entry;
      bestScore = score;
    }
  }

  return bestScore >= 0 ? bestEntry : null;
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

  private async snapshotText(): Promise<string> {
    return this.runtime.callText("take_snapshot", {});
  }

  private async describeSelectorTarget(
    selector: string,
  ): Promise<ChromeDevtoolsSnapshotQuery> {
    return this.runtime.callJson<ChromeDevtoolsSnapshotQuery>(
      "evaluate_script",
      {
        function: `() => {
        ${buildSelectorResolver(serialize(selector))}
        if (!(first instanceof Element)) {
          throw new Error("Selector not found: ${escapeTemplateLiteral(selector)}");
        }

        const read = (value) => typeof value === "string" ? value.trim() : "";
        const roleFromTag = () => {
          if (first instanceof HTMLButtonElement) return "button";
          if (first instanceof HTMLAnchorElement && first.href) return "link";
          if (first instanceof HTMLTextAreaElement) return "textbox";
          if (first instanceof HTMLSelectElement) return "combobox";
          if (first instanceof HTMLInputElement) {
            const type = read(first.type).toLowerCase();
            if (!type || ["text", "search", "email", "url", "tel", "password", "number"].includes(type)) {
              return "textbox";
            }
            if (type === "checkbox") return "checkbox";
            if (type === "radio") return "radio";
            if (type === "button" || type === "submit" || type === "reset") return "button";
          }
          const tagName = read(first.nodeName).toLowerCase();
          return tagName || "";
        };

        const textContent = first instanceof HTMLElement
          ? read(first.innerText) || read(first.textContent)
          : read(first.textContent);
        const valueText =
          first instanceof HTMLInputElement || first instanceof HTMLTextAreaElement
            ? read(first.value) || read(first.placeholder)
            : "";

        return JSON.stringify({
          role: read(first.getAttribute("role")) || roleFromTag() || undefined,
          name:
            read(first.getAttribute("aria-label")) ||
            read(first.getAttribute("title")) ||
            valueText ||
            textContent ||
            undefined,
          text: textContent || valueText || undefined,
        });
      }`,
      },
    );
  }

  private async resolveTargetUid(
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

    const entries = parseChromeDevtoolsSnapshotEntries(
      await this.snapshotText(),
    );
    const match = findBestChromeDevtoolsSnapshotEntry(entries, query);
    if (!match) {
      throw new Error(
        `Unable to resolve Chrome DevTools MCP target from snapshot: ${JSON.stringify(query)}`,
      );
    }

    return match.uid;
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
    await this.runtime.callTool("fill", {
      uid: await this.resolveTargetUid(selector),
      value,
    });
  }

  private async refreshUrlFromPage(): Promise<void> {
    this.cachedUrl = await this.evaluateJson<string>(
      "return JSON.stringify(window.location.href);",
    );
  }

  async goto(
    url: string,
    opts?: {
      waitUntil?: "load" | "domcontentloaded" | "networkidle";
      timeoutMs?: number;
    },
  ): Promise<void> {
    await this.runtime.callTool("navigate_page", {
      type: "url",
      url,
      ...(typeof opts?.timeoutMs === "number"
        ? { timeout: opts.timeoutMs }
        : {}),
    });
    this.cachedUrl = url;
  }

  async reload(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<void> {
    await this.runtime.callTool("navigate_page", {
      type: "reload",
      ...(typeof opts?.timeoutMs === "number"
        ? { timeout: opts.timeoutMs }
        : {}),
    });
    await this.refreshUrlFromPage();
  }

  async back(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<boolean> {
    await this.runtime.callTool("navigate_page", {
      type: "back",
      ...(typeof opts?.timeoutMs === "number"
        ? { timeout: opts.timeoutMs }
        : {}),
    });
    await this.refreshUrlFromPage();
    return true;
  }

  async forward(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<boolean> {
    await this.runtime.callTool("navigate_page", {
      type: "forward",
      ...(typeof opts?.timeoutMs === "number"
        ? { timeout: opts.timeoutMs }
        : {}),
    });
    await this.refreshUrlFromPage();
    return true;
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
    const artifactPath = this.runtime.artifactPath(filename);
    await this.runtime.callTool("take_screenshot", {
      format: opts?.type ?? "png",
      fullPage: opts?.fullPage ?? false,
      filePath: artifactPath,
      ...(typeof opts?.quality === "number" ? { quality: opts.quality } : {}),
    });
    return this.runtime.readArtifact(filename);
  }

  async setViewport(size: { width: number; height: number }): Promise<void> {
    await this.runtime.callTool("emulate", {
      viewport: `${size.width}x${size.height}x1`,
    });

    const deadline = Date.now() + 2_000;
    while (Date.now() < deadline) {
      const viewport = await this.evaluateJson<{
        width: number;
        height: number;
      }>(`
        return JSON.stringify({
          width: window.innerWidth,
          height: window.innerHeight,
        });
      `);
      if (viewport.width === size.width && viewport.height === size.height) {
        return;
      }
      await sleep(100);
    }
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

  async click(
    targetOrX: string | ActionTarget | number,
    y?: number,
  ): Promise<void> {
    if (typeof targetOrX === "number") {
      if (typeof y !== "number") {
        throw new Error("click(x, y) requires both numeric coordinates");
      }
      await this.dispatchPointerAtCoordinates(targetOrX, y, [
        "mousedown",
        "mouseup",
        "click",
      ]);
      return;
    }

    const target =
      typeof targetOrX === "string"
        ? ({ kind: "selector", value: targetOrX } as const)
        : targetOrX;

    switch (target.kind) {
      case "selector":
        await this.runtime.callTool("click", {
          uid: await this.resolveTargetUid(target.value),
        });
        return;
      case "coords":
        await this.click(target.x, target.y);
        return;
      case "text":
        await this.runtime.callTool("click", {
          uid: await this.resolveTargetUid(target),
        });
        return;
      case "role_name":
        await this.runtime.callTool("click", {
          uid: await this.resolveTargetUid(target),
        });
        return;
      default:
        throw new Error(
          `chrome_devtools_mcp does not support click target kind "${target.kind}" yet`,
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
      await this.dispatchPointerAtCoordinates(targetOrX, y, [
        "mousemove",
        "mouseover",
        "mouseenter",
      ]);
      return;
    }

    const target =
      typeof targetOrX === "string"
        ? ({ kind: "selector", value: targetOrX } as const)
        : targetOrX;

    switch (target.kind) {
      case "selector":
        await this.runtime.callTool("hover", {
          uid: await this.resolveTargetUid(target.value),
        });
        return;
      case "coords":
        await this.hover(target.x, target.y);
        return;
      case "text":
        await this.runtime.callTool("hover", {
          uid: await this.resolveTargetUid(target),
        });
        return;
      case "role_name":
        await this.runtime.callTool("hover", {
          uid: await this.resolveTargetUid(target),
        });
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
        throw new Error(
          `chrome_devtools_mcp does not support type target kind "${target.kind}" yet`,
        );
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
        throw new Error(
          `chrome_devtools_mcp does not support press target kind "${target.kind}" yet`,
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
      return (
        typeof input.toolPageId === "number" &&
        page.toolPageId === input.toolPageId
      );
    });

    if (existing) {
      existing.handle.setCachedUrl(input.url);
      return existing;
    }

    const tracked: TrackedChromePage = {
      id: this.nextPageId(),
      toolPageId: input.toolPageId,
      handle: new ChromeDevtoolsMcpPageHandle(this.runtime, "", input.url),
    };
    tracked.handle = new ChromeDevtoolsMcpPageHandle(
      this.runtime,
      tracked.id,
      input.url,
    );
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
        return (
          typeof page.toolPageId === "number" && !beforeIds.has(page.toolPageId)
        );
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
        args.push(
          "--wsHeaders",
          JSON.stringify(input.providedEndpoint.headers),
        );
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
