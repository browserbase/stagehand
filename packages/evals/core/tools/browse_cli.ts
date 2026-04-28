import { execFile } from "node:child_process";
import fs from "node:fs";
import { promisify } from "node:util";
import path from "node:path";
import type { PageRepresentation } from "../contracts/representation.js";
import type { Artifact, ConnectionMode } from "../contracts/results.js";
import type {
  ActionTarget,
  FocusedTarget,
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
import { getRepoRootDir } from "../../runtimePaths.js";

const execFileAsync = promisify(execFile);

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

const BROWSE_CLI_ENTRYPOINT = path.join(
  getRepoRootDir(),
  "packages",
  "cli",
  "dist",
  "index.js",
);

function resolveBrowseCliEntrypoint(): string {
  if (!fs.existsSync(BROWSE_CLI_ENTRYPOINT)) {
    throw new Error(
      `browse_cli requires a built CLI entrypoint at ${BROWSE_CLI_ENTRYPOINT}. Run pnpm --dir packages/cli build first.`,
    );
  }

  return BROWSE_CLI_ENTRYPOINT;
}

function serializeArg(value: unknown): string {
  return typeof value === "undefined" ? "undefined" : JSON.stringify(value);
}

function buildSelectorQuery(selector: string): string {
  return `
    const selector = ${JSON.stringify(selector)};
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
      return Array.from(document.querySelectorAll(selector));
    };
    const elements = resolveElements();
    const first = elements[0] ?? null;
  `;
}

type BrowseCliPagesResult = {
  pages: Array<{
    index: number;
    url: string;
    targetId: string;
  }>;
};

class BrowseCliRuntime {
  constructor(private readonly session: string) {}

  async runJson<T>(args: string[]): Promise<T> {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        resolveBrowseCliEntrypoint(),
        "--json",
        "--session",
        this.session,
        ...args,
      ],
      {
        cwd: getRepoRootDir(),
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    const trimmed = stdout.trim();
    if (!trimmed) {
      const detail = stderr.trim();
      throw new Error(
        detail || `browse ${args.join(" ")} returned no JSON output`,
      );
    }

    return JSON.parse(trimmed) as T;
  }
}

class BrowseCliLocatorHandle implements CoreLocatorHandle {
  constructor(
    private readonly pageHandle: BrowseCliPageHandle,
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
    await this.pageHandle.type(this.selector, value);
  }

  async type(text: string): Promise<void> {
    await this.pageHandle.type(this.selector, text);
  }

  async isVisible(): Promise<boolean> {
    return this.pageHandle
      .runCommandAfterSelecting<{
        visible: boolean;
      }>(["is", "visible", this.selector])
      .then((result) => result.visible);
  }

  async textContent(): Promise<string | null> {
    return this.pageHandle
      .runCommandAfterSelecting<{
        text: string | null;
      }>(["get", "text", this.selector])
      .then((result) => result.text ?? null);
  }

  async inputValue(): Promise<string> {
    return this.pageHandle
      .runCommandAfterSelecting<{
        value: string;
      }>(["get", "value", this.selector])
      .then((result) => result.value);
  }
}

class BrowseCliPageHandle implements CorePageHandle {
  constructor(
    private readonly session: BrowseCliSession,
    readonly id: string,
    private cachedUrl = "about:blank",
  ) {}

  setCachedUrl(url: string): void {
    this.cachedUrl = url;
  }

  url(): string {
    return this.cachedUrl;
  }

  async runCommandAfterSelecting<T>(args: string[]): Promise<T> {
    await this.session.selectIfNeeded(this.id);
    return this.session.runtime.runJson<T>(args);
  }

  private async refreshUrl(): Promise<void> {
    const result = await this.runCommandAfterSelecting<{ url: string }>([
      "get",
      "url",
    ]);
    this.cachedUrl = result.url;
  }

  async evaluateSelector<R>(selector: string, body: string): Promise<R> {
    return this.evaluate<R>(`
      (() => {
        ${buildSelectorQuery(selector)}
        ${body}
      })()
    `);
  }

  async goto(
    url: string,
    opts?: {
      waitUntil?: "load" | "domcontentloaded" | "networkidle";
      timeoutMs?: number;
    },
  ): Promise<void> {
    const args = ["open", url];
    if (opts?.waitUntil) {
      args.push("--wait", opts.waitUntil);
    }
    if (typeof opts?.timeoutMs === "number") {
      args.push("-t", String(opts.timeoutMs));
    }
    const result = await this.runCommandAfterSelecting<{ url: string }>(args);
    this.cachedUrl = result.url;
  }

  async reload(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<void> {
    void opts;
    const result = await this.runCommandAfterSelecting<{ url: string }>([
      "reload",
    ]);
    this.cachedUrl = result.url;
  }

  async back(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<boolean> {
    void opts;
    const result = await this.runCommandAfterSelecting<{ url: string }>([
      "back",
    ]);
    this.cachedUrl = result.url;
    return true;
  }

  async forward(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<boolean> {
    void opts;
    const result = await this.runCommandAfterSelecting<{ url: string }>([
      "forward",
    ]);
    this.cachedUrl = result.url;
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
    const result = await this.runCommandAfterSelecting<{ title: string }>([
      "get",
      "title",
    ]);
    return result.title;
  }

  async evaluate<R = unknown, Arg = unknown>(
    pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    const expression =
      typeof pageFunctionOrExpression === "string"
        ? pageFunctionOrExpression
        : `(${pageFunctionOrExpression.toString()})(${serializeArg(arg)})`;

    const result = await this.runCommandAfterSelecting<{ result: R }>([
      "eval",
      expression,
    ]);
    return result.result;
  }

  async screenshot(opts?: {
    fullPage?: boolean;
    type?: "png" | "jpeg";
    quality?: number;
  }): Promise<Buffer> {
    const args = ["screenshot"];
    if (opts?.fullPage) {
      args.push("-f");
    }
    if (opts?.type) {
      args.push("-t", opts.type);
    }
    if (typeof opts?.quality === "number") {
      args.push("-q", String(opts.quality));
    }

    const result = await this.runCommandAfterSelecting<{ base64: string }>(
      args,
    );
    return Buffer.from(result.base64, "base64");
  }

  async setViewport(size: { width: number; height: number }): Promise<void> {
    await this.runCommandAfterSelecting([
      "viewport",
      String(size.width),
      String(size.height),
    ]);
  }

  async setViewportSize(width: number, height: number): Promise<void> {
    await this.setViewport({ width, height });
  }

  async wait(spec: WaitSpec): Promise<void> {
    switch (spec.kind) {
      case "selector":
        await this.runCommandAfterSelecting([
          "wait",
          "selector",
          spec.selector,
          "-t",
          String(spec.timeoutMs ?? 30_000),
          "-s",
          spec.state ?? "visible",
        ]);
        return;
      case "timeout":
        await this.runCommandAfterSelecting([
          "wait",
          "timeout",
          String(spec.timeoutMs),
        ]);
        return;
      case "load_state":
        await this.runCommandAfterSelecting([
          "wait",
          "load",
          spec.state,
          "-t",
          String(spec.timeoutMs ?? 30_000),
        ]);
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
    await this.wait({
      kind: "selector",
      selector,
      timeoutMs: opts?.timeout,
      state: opts?.state,
    });
    return true;
  }

  async waitForTimeout(ms: number): Promise<void> {
    await this.wait({ kind: "timeout", timeoutMs: ms });
  }

  locator(selector: string): CoreLocatorHandle {
    return new BrowseCliLocatorHandle(this, selector);
  }

  private refSelector(ref: string): string {
    return ref.startsWith("@") ? ref : `@${ref}`;
  }

  private async resolveHoverPoint(
    selector: string,
  ): Promise<{ x: number; y: number }> {
    return this.runCommandAfterSelecting<{ x: number; y: number }>([
      "get",
      "box",
      selector,
    ]);
  }

  async click(
    targetOrX: string | ActionTarget | number,
    y?: number,
  ): Promise<void> {
    if (typeof targetOrX === "number") {
      if (typeof y !== "number") {
        throw new Error("click(x, y) requires both numeric coordinates");
      }
      await this.runCommandAfterSelecting([
        "click_xy",
        String(targetOrX),
        String(y),
      ]);
      return;
    }

    const target =
      typeof targetOrX === "string"
        ? ({ kind: "selector", value: targetOrX } as const)
        : targetOrX;

    switch (target.kind) {
      case "selector":
        await this.runCommandAfterSelecting(["click", target.value]);
        return;
      case "snapshot_ref":
        await this.runCommandAfterSelecting([
          "click",
          this.refSelector(target.value),
        ]);
        return;
      case "coords":
        await this.runCommandAfterSelecting([
          "click_xy",
          String(target.x),
          String(target.y),
        ]);
        return;
      default:
        throw new Error(
          `browse_cli does not support click target kind "${target.kind}" yet`,
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
      await this.runCommandAfterSelecting([
        "hover",
        String(targetOrX),
        String(y),
      ]);
      return;
    }

    const target =
      typeof targetOrX === "string"
        ? ({ kind: "selector", value: targetOrX } as const)
        : targetOrX;

    switch (target.kind) {
      case "selector": {
        const point = await this.resolveHoverPoint(target.value);
        await this.runCommandAfterSelecting([
          "hover",
          String(point.x),
          String(point.y),
        ]);
        return;
      }
      case "coords":
        await this.runCommandAfterSelecting([
          "hover",
          String(target.x),
          String(target.y),
        ]);
        return;
      default:
        throw new Error(
          `browse_cli does not support hover target kind "${target.kind}" yet`,
        );
    }
  }

  async scroll(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
  ): Promise<void> {
    await this.runCommandAfterSelecting([
      "scroll",
      String(x),
      String(y),
      String(deltaX),
      String(deltaY),
    ]);
  }

  async type(
    targetOrText: string | ActionTarget | FocusedTarget,
    text?: string,
  ): Promise<void> {
    if (typeof targetOrText === "string" && typeof text === "undefined") {
      await this.runCommandAfterSelecting(["type", targetOrText]);
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
        await this.runCommandAfterSelecting(["type", text]);
        return;
      case "selector":
        await this.runCommandAfterSelecting([
          "fill",
          target.value,
          text,
          "--no-press-enter",
        ]);
        return;
      default:
        throw new Error(
          `browse_cli does not support type target kind "${target.kind}" yet`,
        );
    }
  }

  async press(
    targetOrKey: string | ActionTarget | FocusedTarget,
    key?: string,
  ): Promise<void> {
    if (typeof targetOrKey === "string" && typeof key === "undefined") {
      await this.runCommandAfterSelecting(["press", targetOrKey]);
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
        await this.runCommandAfterSelecting(["press", key]);
        return;
      case "selector":
        await this.runCommandAfterSelecting(["click", target.value]);
        await this.runCommandAfterSelecting(["press", key]);
        return;
      case "snapshot_ref":
        await this.runCommandAfterSelecting([
          "click",
          this.refSelector(target.value),
        ]);
        await this.runCommandAfterSelecting(["press", key]);
        return;
      case "coords":
        await this.runCommandAfterSelecting([
          "click_xy",
          String(target.x),
          String(target.y),
        ]);
        await this.runCommandAfterSelecting(["press", key]);
        return;
      default:
        throw new Error(
          `browse_cli does not support press target kind "${target.kind}" yet`,
        );
    }
  }

  async represent(): Promise<PageRepresentation> {
    const snapshot = await this.runCommandAfterSelecting<{
      tree: string;
      xpathMap?: Record<string, string>;
      urlMap?: Record<string, string>;
    }>(["snapshot"]);
    const content = snapshot.tree;

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

class BrowseCliSession implements CoreSession {
  readonly runtime: BrowseCliRuntime;
  private readonly handles = new Map<string, BrowseCliPageHandle>();
  private activePageId: string | null = null;
  private closed = false;

  constructor(private readonly sessionName: string) {
    this.runtime = new BrowseCliRuntime(sessionName);
  }

  private wrap(page: { targetId: string; url: string }): BrowseCliPageHandle {
    const existing = this.handles.get(page.targetId);
    if (existing) {
      existing.setCachedUrl(page.url);
      return existing;
    }

    const handle = new BrowseCliPageHandle(this, page.targetId, page.url);
    this.handles.set(page.targetId, handle);
    return handle;
  }

  private async fetchPages(): Promise<BrowseCliPagesResult["pages"]> {
    const result = await this.runtime.runJson<BrowseCliPagesResult>(["pages"]);
    const pages = result.pages ?? [];

    for (const page of pages) {
      this.wrap(page);
    }

    if (
      this.activePageId &&
      !pages.some((page) => page.targetId === this.activePageId)
    ) {
      this.activePageId = null;
    }
    if (!this.activePageId && pages.length > 0) {
      this.activePageId = pages[0].targetId;
    }

    return pages;
  }

  async selectIfNeeded(pageId: string): Promise<void> {
    if (this.activePageId === pageId) return;
    await this.selectPage(pageId);
  }

  async listPages(): Promise<CorePageHandle[]> {
    const pages = await this.fetchPages();
    return pages.map((page) => this.wrap(page));
  }

  async activePage(): Promise<CorePageHandle> {
    const pages = await this.fetchPages();
    if (this.activePageId) {
      const active = pages.find((page) => page.targetId === this.activePageId);
      if (active) return this.wrap(active);
    }
    if (pages.length === 0) {
      throw new Error("No active page available");
    }
    this.activePageId = pages[0].targetId;
    return this.wrap(pages[0]);
  }

  async newPage(url?: string): Promise<CorePageHandle> {
    const args = ["newpage"];
    if (url) {
      args.push(url);
    }
    const result = await this.runtime.runJson<{
      created: boolean;
      url: string;
      targetId: string;
    }>(args);
    this.activePageId = result.targetId;
    await this.fetchPages();
    return this.wrap(result);
  }

  async selectPage(pageId: string): Promise<void> {
    const pages = await this.fetchPages();
    const page = pages.find((candidate) => candidate.targetId === pageId);
    if (!page) {
      throw new Error(`Unknown page id "${pageId}"`);
    }

    await this.runtime.runJson(["tab_switch", String(page.index)]);
    this.activePageId = pageId;
  }

  async closePage(pageId: string): Promise<void> {
    const pages = await this.fetchPages();
    const page = pages.find((candidate) => candidate.targetId === pageId);
    if (!page) {
      throw new Error(`Unknown page id "${pageId}"`);
    }

    await this.runtime.runJson(["tab_close", String(page.index)]);
    this.handles.delete(pageId);
    const remaining = await this.fetchPages();
    this.activePageId = remaining[0]?.targetId ?? null;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    try {
      await this.runtime.runJson(["stop", "--force"]);
    } catch {
      // best-effort only
    }
  }

  async getArtifacts(): Promise<Artifact[]> {
    return [];
  }

  async getRawMetrics(): Promise<Record<string, unknown>> {
    return {
      sessionName: this.sessionName,
    };
  }
}

function connectionModeFromProfile(
  startupProfile: StartupProfile,
): ConnectionMode {
  if (startupProfile === "tool_launch_local") {
    return "launch";
  }

  if (startupProfile === "tool_create_browserbase") {
    return "browserbase_native";
  }

  return "launch";
}

function createSessionName(): string {
  return `evals-browse-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class BrowseCliTool implements CoreTool {
  readonly id = "browse_cli";
  readonly surface = "cli";
  readonly family = "stagehand_cli";
  readonly supportedStartupProfiles: StartupProfile[] = [
    "tool_launch_local",
    "tool_create_browserbase",
  ];
  readonly supportedCapabilities: CoreCapability[] = [
    ...SUPPORTED_CAPABILITIES,
  ];
  readonly supportedTargetKinds: TargetKind[] = [
    "selector",
    "coords",
    "focused",
    "snapshot_ref",
  ];

  async start(input: ToolStartInput): Promise<ToolStartResult> {
    if (
      input.startupProfile !== "tool_launch_local" &&
      input.startupProfile !== "tool_create_browserbase"
    ) {
      throw new Error(
        `browse_cli does not support startup profile "${input.startupProfile}" yet`,
      );
    }

    if (
      (input.environment === "LOCAL" &&
        input.startupProfile !== "tool_launch_local") ||
      (input.environment === "BROWSERBASE" &&
        input.startupProfile !== "tool_create_browserbase")
    ) {
      throw new Error(
        `browse_cli startup profile "${input.startupProfile}" is not valid for environment "${input.environment}"`,
      );
    }

    const session = new BrowseCliSession(createSessionName());
    await session.runtime.runJson([
      "env",
      input.environment === "BROWSERBASE" ? "remote" : "local",
    ]);

    return {
      session,
      cleanup: async () => {
        await session.close();
      },
      metadata: {
        environment:
          input.environment === "BROWSERBASE" ? "browserbase" : "local",
        browserOwnership: "tool",
        connectionMode: connectionModeFromProfile(input.startupProfile),
        startupProfile: input.startupProfile,
      },
    };
  }
}
