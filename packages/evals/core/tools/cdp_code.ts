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
import type { Artifact, ConnectionMode } from "../contracts/results.js";
import type {
  ActionTarget,
  TargetKind,
  WaitSpec,
} from "../contracts/targets.js";
import { loadWsModule } from "../runtime/coreDeps.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const POLL_INTERVAL_MS = 100;

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
];

export type CdpEventMessage = {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
};

type SelectorInspection = {
  count: number;
  visible: boolean;
  textContent: string | null;
  value: string;
  center: { x: number; y: number } | null;
};

type CdpPageState = {
  targetId: string;
  sessionId: string;
  currentUrl: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeEvaluationArg(arg: unknown): string {
  return typeof arg === "undefined" ? "undefined" : JSON.stringify(arg);
}

export function buildCdpEvaluationExpression<Arg>(
  pageFunctionOrExpression: string | ((arg: Arg) => unknown),
  arg?: Arg,
): string {
  if (typeof pageFunctionOrExpression === "string") {
    return pageFunctionOrExpression;
  }

  return `(() => {
            const __name = (target) => target;
            return (${pageFunctionOrExpression.toString()})(${serializeEvaluationArg(arg)});
          })()`;
}

function isPrintableKey(key: string): boolean {
  return key.length === 1;
}

function keyEventPayload(key: string): {
  key: string;
  code: string;
  windowsVirtualKeyCode: number;
} {
  const specialKeys: Record<
    string,
    { key: string; code: string; windowsVirtualKeyCode: number }
  > = {
    Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
    Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
    Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    Backspace: {
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
    },
    Space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
    ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
    ArrowDown: {
      key: "ArrowDown",
      code: "ArrowDown",
      windowsVirtualKeyCode: 40,
    },
    ArrowLeft: {
      key: "ArrowLeft",
      code: "ArrowLeft",
      windowsVirtualKeyCode: 37,
    },
    ArrowRight: {
      key: "ArrowRight",
      code: "ArrowRight",
      windowsVirtualKeyCode: 39,
    },
  };

  const special = specialKeys[key];
  if (special) return special;

  const normalized = key.toUpperCase();
  return {
    key,
    code: /^[A-Z]$/.test(normalized) ? `Key${normalized}` : "",
    windowsVirtualKeyCode: normalized.charCodeAt(0),
  };
}

async function resolveWebSocketEndpoint(input: {
  kind: "ws" | "http";
  url: string;
}): Promise<string> {
  if (input.kind === "ws") {
    return input.url;
  }

  const baseUrl = input.url.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/json/version`);
  if (!response.ok) {
    throw new Error(
      `Failed to resolve CDP websocket URL from ${baseUrl}: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as {
    webSocketDebuggerUrl?: string;
  };

  if (!payload.webSocketDebuggerUrl) {
    throw new Error(
      `CDP endpoint ${baseUrl} did not return webSocketDebuggerUrl`,
    );
  }

  return payload.webSocketDebuggerUrl;
}

export class CdpConnection {
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly eventListeners = new Set<(event: CdpEventMessage) => void>();
  private readonly ws: {
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    once: (event: string, listener: (...args: unknown[]) => void) => void;
    send: (data: string, cb?: (error?: Error) => void) => void;
    close: () => void;
  };
  private nextId = 0;
  private closed = false;

  private constructor(ws: {
    on: (event: string, listener: (...args: unknown[]) => void) => void;
    once: (event: string, listener: (...args: unknown[]) => void) => void;
    send: (data: string, cb?: (error?: Error) => void) => void;
    close: () => void;
  }) {
    this.ws = ws;
    this.ws.on("message", (data: unknown) => {
      this.handleMessage(data);
    });
    this.ws.on("error", (error: unknown) => {
      const resolved =
        error instanceof Error ? error : new Error(String(error));
      this.rejectAll(resolved);
    });
    this.ws.on("close", () => {
      this.closed = true;
      this.rejectAll(new Error("CDP websocket closed"));
    });
  }

  static async connect(input: {
    kind: "ws" | "http";
    url: string;
    headers?: Record<string, string>;
  }): Promise<CdpConnection> {
    const wsUrl = await resolveWebSocketEndpoint(input);
    const WebSocket = loadWsModule();

    const ws = await new Promise<{
      on: (event: string, listener: (...args: unknown[]) => void) => void;
      once: (event: string, listener: (...args: unknown[]) => void) => void;
      send: (data: string, cb?: (error?: Error) => void) => void;
      close: () => void;
    }>((resolve, reject) => {
      const socket = new WebSocket(
        wsUrl,
        input.headers ? { headers: input.headers } : {},
      );
      socket.once("open", () => resolve(socket));
      socket.once("error", (error: unknown) => {
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });

    return new CdpConnection(ws);
  }

  onEvent(listener: (event: CdpEventMessage) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  async send<T = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<T> {
    if (this.closed) {
      throw new Error("CDP websocket is already closed");
    }

    const id = ++this.nextId;
    const payload = {
      id,
      method,
      ...(params ? { params } : {}),
      ...(sessionId ? { sessionId } : {}),
    };

    const result = await new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload), (error?: Error) => {
        if (!error) return;
        this.pending.delete(id);
        reject(error);
      });
    });

    return result;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.ws.close();
  }

  private handleMessage(raw: unknown): void {
    const data =
      typeof raw === "string"
        ? raw
        : Buffer.isBuffer(raw)
          ? raw.toString("utf8")
          : String(raw);
    const message = JSON.parse(data) as
      | {
          id: number;
          result?: unknown;
          error?: { message?: string };
        }
      | (CdpEventMessage & { id?: never });

    if ("id" in message && typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      const commandMessage = message as {
        id: number;
        result?: unknown;
        error?: { message?: string };
      };
      if (commandMessage.error) {
        pending.reject(
          new Error(commandMessage.error.message ?? "CDP command failed"),
        );
        return;
      }
      pending.resolve(commandMessage.result);
      return;
    }

    const eventMessage = message as CdpEventMessage;
    for (const listener of this.eventListeners) {
      listener(eventMessage);
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

class CdpLocatorHandle implements CoreLocatorHandle {
  constructor(
    private readonly page: CdpPageHandle,
    private readonly selector: string,
  ) {}

  async count(): Promise<number> {
    return (await this.page.inspectSelector(this.selector)).count;
  }

  async click(): Promise<void> {
    await this.page.click(this.selector);
  }

  async hover(): Promise<void> {
    await this.page.hover(this.selector);
  }

  async fill(value: string): Promise<void> {
    await this.page.fillSelector(this.selector, value);
  }

  async type(text: string): Promise<void> {
    await this.page.type(this.selector, text);
  }

  async isVisible(): Promise<boolean> {
    return (await this.page.inspectSelector(this.selector)).visible;
  }

  async textContent(): Promise<string | null> {
    return (await this.page.inspectSelector(this.selector)).textContent;
  }

  async inputValue(): Promise<string> {
    return (await this.page.inspectSelector(this.selector)).value;
  }
}

class CdpPageHandle implements CorePageHandle {
  constructor(
    private readonly connection: CdpConnection,
    private readonly state: CdpPageState,
  ) {}

  get id(): string {
    return this.state.targetId;
  }

  url(): string {
    return this.state.currentUrl;
  }

  async goto(
    url: string,
    opts?: {
      waitUntil?: "load" | "domcontentloaded" | "networkidle";
      timeoutMs?: number;
    },
  ): Promise<void> {
    await this.connection.send("Page.navigate", { url }, this.state.sessionId);
    await this.waitForReadyState(opts?.waitUntil ?? "load", opts?.timeoutMs);
    await this.refreshUrl();
  }

  async reload(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<void> {
    await this.connection.send("Page.reload", {}, this.state.sessionId);
    await this.waitForReadyState(opts?.waitUntil ?? "load", opts?.timeoutMs);
    await this.refreshUrl();
  }

  async back(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<boolean> {
    return this.navigateHistory(-1, opts);
  }

  async forward(opts?: {
    waitUntil?: "load" | "domcontentloaded" | "networkidle";
    timeoutMs?: number;
  }): Promise<boolean> {
    return this.navigateHistory(1, opts);
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
    return this.evaluate(() => document.title);
  }

  async evaluate<R = unknown, Arg = unknown>(
    pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>),
    arg?: Arg,
  ): Promise<R> {
    const expression = buildCdpEvaluationExpression(
      pageFunctionOrExpression,
      arg,
    );

    const response = (await this.connection.send(
      "Runtime.evaluate",
      {
        expression,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      },
      this.state.sessionId,
    )) as {
      result?: { value?: R };
      exceptionDetails?: {
        text?: string;
        exception?: {
          description?: string;
          value?: unknown;
        };
      };
    };

    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text ??
          "CDP Runtime.evaluate failed",
      );
    }

    return response.result?.value as R;
  }

  async screenshot(opts?: {
    fullPage?: boolean;
    type?: "png" | "jpeg";
    quality?: number;
  }): Promise<Buffer> {
    const response = (await this.connection.send(
      "Page.captureScreenshot",
      {
        format: opts?.type ?? "png",
        ...(typeof opts?.quality === "number" ? { quality: opts.quality } : {}),
        ...(opts?.fullPage ? { captureBeyondViewport: true } : {}),
      },
      this.state.sessionId,
    )) as { data: string };

    return Buffer.from(response.data, "base64");
  }

  async setViewport(size: { width: number; height: number }): Promise<void> {
    await this.setViewportSize(size.width, size.height);
  }

  async setViewportSize(width: number, height: number): Promise<void> {
    await this.connection.send(
      "Emulation.setDeviceMetricsOverride",
      {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      },
      this.state.sessionId,
    );
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
        await this.waitForReadyState(spec.state, spec.timeoutMs);
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
    const timeoutMs = opts?.timeout ?? DEFAULT_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    const expectedState = opts?.state ?? "attached";

    while (Date.now() < deadline) {
      const inspection = await this.inspectSelector(selector);
      const attached = inspection.count > 0;
      const hidden = !inspection.visible;

      if (
        (expectedState === "attached" && attached) ||
        (expectedState === "visible" && inspection.visible) ||
        (expectedState === "detached" && !attached) ||
        (expectedState === "hidden" && attached && hidden)
      ) {
        return true;
      }

      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(
      `Timed out waiting for selector "${selector}" to be ${expectedState}`,
    );
  }

  async waitForTimeout(ms: number): Promise<void> {
    await sleep(ms);
  }

  locator(selector: string): CoreLocatorHandle {
    return new CdpLocatorHandle(this, selector);
  }

  async click(
    targetOrX: string | ActionTarget | number,
    y?: number,
  ): Promise<void> {
    if (typeof targetOrX === "number") {
      if (typeof y !== "number") {
        throw new Error("click(x, y) requires both numeric coordinates");
      }
      await this.dispatchMouseClick(targetOrX, y);
      return;
    }

    const target =
      typeof targetOrX === "string"
        ? ({ kind: "selector", value: targetOrX } as const)
        : targetOrX;

    switch (target.kind) {
      case "selector": {
        const center = await this.centerForSelector(target.value);
        await this.dispatchMouseClick(center.x, center.y);
        return;
      }
      case "coords":
        await this.dispatchMouseClick(target.x, target.y);
        return;
      default:
        throw new Error(
          `cdp_code does not support click target kind "${target.kind}" yet`,
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
      await this.dispatchMouseMove(targetOrX, y);
      return;
    }

    const target =
      typeof targetOrX === "string"
        ? ({ kind: "selector", value: targetOrX } as const)
        : targetOrX;

    switch (target.kind) {
      case "selector": {
        const center = await this.centerForSelector(target.value);
        await this.dispatchMouseMove(center.x, center.y);
        return;
      }
      case "coords":
        await this.dispatchMouseMove(target.x, target.y);
        return;
      default:
        throw new Error(
          `cdp_code does not support hover target kind "${target.kind}" yet`,
        );
    }
  }

  async scroll(
    x: number,
    y: number,
    deltaX: number,
    deltaY: number,
  ): Promise<void> {
    await this.dispatchMouseMove(x, y);
    await this.connection.send(
      "Input.dispatchMouseEvent",
      {
        type: "mouseWheel",
        x,
        y,
        deltaX,
        deltaY,
      },
      this.state.sessionId,
    );
  }

  async type(
    targetOrText: string | ActionTarget | { kind: "focused" },
    text?: string,
  ): Promise<void> {
    if (typeof targetOrText === "string" && typeof text === "undefined") {
      await this.insertText(targetOrText);
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
        await this.insertText(text);
        return;
      case "selector":
        await this.focusSelector(target.value);
        await this.insertText(text);
        return;
      case "coords":
        await this.dispatchMouseClick(target.x, target.y);
        await this.insertText(text);
        return;
      default:
        throw new Error(
          `cdp_code does not support type target kind "${target.kind}" yet`,
        );
    }
  }

  async press(
    targetOrKey: string | ActionTarget | { kind: "focused" },
    key?: string,
  ): Promise<void> {
    if (typeof targetOrKey === "string" && typeof key === "undefined") {
      await this.dispatchKey(targetOrKey);
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
        await this.dispatchKey(key);
        return;
      case "selector":
        await this.focusSelector(target.value);
        await this.dispatchKey(key);
        return;
      case "coords":
        await this.dispatchMouseClick(target.x, target.y);
        await this.dispatchKey(key);
        return;
      default:
        throw new Error(
          `cdp_code does not support press target kind "${target.kind}" yet`,
        );
    }
  }

  async inspectSelector(selector: string): Promise<SelectorInspection> {
    return this.evaluate((rawSelector: string) => {
      function queryAll(selectorInput: string): Element[] {
        if (selectorInput.startsWith("xpath=")) {
          const expression = selectorInput.slice("xpath=".length);
          const result = document.evaluate(
            expression,
            document,
            null,
            XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
            null,
          );
          const nodes: Element[] = [];
          for (let index = 0; index < result.snapshotLength; index += 1) {
            const node = result.snapshotItem(index);
            if (node instanceof Element) {
              nodes.push(node);
            }
          }
          return nodes;
        }
        return Array.from(document.querySelectorAll(selectorInput));
      }

      const matches = queryAll(rawSelector);
      const first = matches[0];
      if (!first) {
        return {
          count: 0,
          visible: false,
          textContent: null,
          value: "",
          center: null,
        };
      }

      const rect = first.getBoundingClientRect();
      const style = window.getComputedStyle(first);
      const visible =
        (rect.width > 0 ||
          rect.height > 0 ||
          first.getClientRects().length > 0) &&
        style.visibility !== "hidden" &&
        style.display !== "none";

      const inputLike = first as HTMLInputElement | HTMLTextAreaElement;

      return {
        count: matches.length,
        visible,
        textContent: first.textContent,
        value: typeof inputLike.value === "string" ? inputLike.value : "",
        center: {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        },
      };
    }, selector);
  }

  async fillSelector(selector: string, value: string): Promise<void> {
    const filled = await this.evaluate(
      ({
        rawSelector,
        nextValue,
      }: {
        rawSelector: string;
        nextValue: string;
      }) => {
        function queryOne(selectorInput: string): HTMLElement | null {
          if (selectorInput.startsWith("xpath=")) {
            const expression = selectorInput.slice("xpath=".length);
            const result = document.evaluate(
              expression,
              document,
              null,
              XPathResult.FIRST_ORDERED_NODE_TYPE,
              null,
            );
            return result.singleNodeValue instanceof HTMLElement
              ? result.singleNodeValue
              : null;
          }
          return document.querySelector(selectorInput);
        }

        const element = queryOne(rawSelector);
        if (!element) return false;

        const inputLike = element as HTMLInputElement | HTMLTextAreaElement;
        element.focus();
        inputLike.value = nextValue;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      },
      { rawSelector: selector, nextValue: value },
    );

    if (!filled) {
      throw new Error(`Unable to fill selector "${selector}"`);
    }
  }

  private async navigateHistory(
    delta: -1 | 1,
    opts?: {
      waitUntil?: "load" | "domcontentloaded" | "networkidle";
      timeoutMs?: number;
    },
  ): Promise<boolean> {
    const history = (await this.connection.send(
      "Page.getNavigationHistory",
      {},
      this.state.sessionId,
    )) as {
      currentIndex: number;
      entries: Array<{ id: number }>;
    };

    const nextEntry = history.entries[history.currentIndex + delta];
    if (!nextEntry) return false;

    await this.connection.send(
      "Page.navigateToHistoryEntry",
      { entryId: nextEntry.id },
      this.state.sessionId,
    );
    await this.waitForReadyState(opts?.waitUntil ?? "load", opts?.timeoutMs);
    await this.refreshUrl();
    return true;
  }

  private async waitForReadyState(
    waitUntil: "load" | "domcontentloaded" | "networkidle",
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        const readyState = await this.evaluate<string>(
          () => document.readyState,
        );
        if (waitUntil === "domcontentloaded") {
          if (readyState === "interactive" || readyState === "complete") {
            return;
          }
        } else if (readyState === "complete") {
          return;
        }
      } catch {
        // retry while navigation settles
      }

      await sleep(POLL_INTERVAL_MS);
    }

    throw new Error(`Timed out waiting for document readyState ${waitUntil}`);
  }

  async refreshUrl(): Promise<void> {
    try {
      this.state.currentUrl = await this.evaluate(() => window.location.href);
    } catch {
      // best-effort only
    }
  }

  private async focusSelector(selector: string): Promise<void> {
    const focused = await this.evaluate((rawSelector: string) => {
      function queryOne(selectorInput: string): HTMLElement | null {
        if (selectorInput.startsWith("xpath=")) {
          const expression = selectorInput.slice("xpath=".length);
          const result = document.evaluate(
            expression,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null,
          );
          return result.singleNodeValue instanceof HTMLElement
            ? result.singleNodeValue
            : null;
        }
        return document.querySelector(selectorInput);
      }

      const element = queryOne(rawSelector);
      if (!element) return false;
      element.scrollIntoView({ block: "center", inline: "center" });
      element.focus();
      return true;
    }, selector);

    if (!focused) {
      throw new Error(`Unable to focus selector "${selector}"`);
    }
  }

  private async centerForSelector(
    selector: string,
  ): Promise<{ x: number; y: number }> {
    const inspection = await this.inspectSelector(selector);
    if (!inspection.center) {
      throw new Error(`Unable to resolve selector "${selector}"`);
    }
    return inspection.center;
  }

  private async dispatchMouseMove(x: number, y: number): Promise<void> {
    await this.connection.send(
      "Input.dispatchMouseEvent",
      {
        type: "mouseMoved",
        x,
        y,
        button: "none",
      },
      this.state.sessionId,
    );
  }

  private async dispatchMouseClick(x: number, y: number): Promise<void> {
    await this.dispatchMouseMove(x, y);
    await this.connection.send(
      "Input.dispatchMouseEvent",
      {
        type: "mousePressed",
        x,
        y,
        button: "left",
        clickCount: 1,
      },
      this.state.sessionId,
    );
    await this.connection.send(
      "Input.dispatchMouseEvent",
      {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        clickCount: 1,
      },
      this.state.sessionId,
    );
  }

  private async insertText(text: string): Promise<void> {
    await this.connection.send(
      "Input.insertText",
      { text },
      this.state.sessionId,
    );
  }

  private async dispatchKey(key: string): Promise<void> {
    if (isPrintableKey(key)) {
      const payload = keyEventPayload(key);
      await this.connection.send(
        "Input.dispatchKeyEvent",
        {
          type: "keyDown",
          text: key,
          unmodifiedText: key,
          ...payload,
        },
        this.state.sessionId,
      );
      await this.connection.send(
        "Input.dispatchKeyEvent",
        {
          type: "keyUp",
          ...payload,
        },
        this.state.sessionId,
      );
      return;
    }

    const payload = keyEventPayload(key);
    await this.connection.send(
      "Input.dispatchKeyEvent",
      {
        type: "rawKeyDown",
        ...payload,
      },
      this.state.sessionId,
    );
    await this.connection.send(
      "Input.dispatchKeyEvent",
      {
        type: "keyUp",
        ...payload,
      },
      this.state.sessionId,
    );
  }
}

class CdpSession implements CoreSession {
  private readonly pages = new Map<string, CdpPageState>();
  private activePageId: string | null = null;
  private closed = false;

  private constructor(private readonly connection: CdpConnection) {}

  static async connect(input: {
    providedEndpoint: {
      kind: "ws" | "http";
      url: string;
      headers?: Record<string, string>;
    };
  }): Promise<CdpSession> {
    const connection = await CdpConnection.connect(input.providedEndpoint);
    const session = new CdpSession(connection);
    await session.bootstrap();
    return session;
  }

  async listPages(): Promise<CorePageHandle[]> {
    return [...this.pages.values()].map(
      (state) => new CdpPageHandle(this.connection, state),
    );
  }

  async activePage(): Promise<CorePageHandle> {
    if (this.activePageId) {
      const state = this.pages.get(this.activePageId);
      if (state) return new CdpPageHandle(this.connection, state);
    }

    const first = this.pages.values().next().value as CdpPageState | undefined;
    if (!first) {
      throw new Error("No active page available");
    }
    this.activePageId = first.targetId;
    return new CdpPageHandle(this.connection, first);
  }

  async newPage(url?: string): Promise<CorePageHandle> {
    const response = (await this.connection.send("Target.createTarget", {
      url: "about:blank",
    })) as { targetId: string };
    const state = await this.attachPage(response.targetId);
    this.activePageId = state.targetId;
    const page = new CdpPageHandle(this.connection, state);
    if (url) {
      await page.goto(url);
    }
    return page;
  }

  async selectPage(pageId: string): Promise<void> {
    const state = this.pages.get(pageId);
    if (!state) {
      throw new Error(`Unknown page id "${pageId}"`);
    }
    await this.connection.send("Page.bringToFront", {}, state.sessionId);
    this.activePageId = pageId;
  }

  async closePage(pageId: string): Promise<void> {
    const state = this.pages.get(pageId);
    if (!state) {
      throw new Error(`Unknown page id "${pageId}"`);
    }
    await this.connection.send("Target.closeTarget", {
      targetId: state.targetId,
    });
    this.pages.delete(pageId);
    if (this.activePageId === pageId) {
      this.activePageId = this.pages.keys().next().value ?? null;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.connection.close();
  }

  async getArtifacts(): Promise<Artifact[]> {
    return [];
  }

  async getRawMetrics(): Promise<Record<string, unknown>> {
    return {
      pageCount: this.pages.size,
    };
  }

  private async bootstrap(): Promise<void> {
    const targetInfos = await this.listPageTargets();
    if (targetInfos.length === 0) {
      const created = (await this.connection.send("Target.createTarget", {
        url: "about:blank",
      })) as { targetId: string };
      await this.attachPage(created.targetId);
    } else {
      for (const targetInfo of targetInfos) {
        await this.attachPage(targetInfo.targetId, targetInfo.url);
      }
    }

    const firstPage = this.pages.keys().next().value as string | undefined;
    this.activePageId = firstPage ?? null;
  }

  private async listPageTargets(): Promise<
    Array<{ targetId: string; url: string }>
  > {
    const response = (await this.connection.send("Target.getTargets")) as {
      targetInfos: Array<{
        targetId: string;
        type: string;
        url?: string;
      }>;
    };

    return response.targetInfos
      .filter(
        (targetInfo) =>
          targetInfo.type === "page" &&
          !targetInfo.url?.startsWith("devtools://"),
      )
      .map((targetInfo) => ({
        targetId: targetInfo.targetId,
        url: targetInfo.url ?? "about:blank",
      }));
  }

  private async attachPage(
    targetId: string,
    initialUrl = "about:blank",
  ): Promise<CdpPageState> {
    if (this.pages.has(targetId)) {
      return this.pages.get(targetId)!;
    }

    const response = (await this.connection.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    })) as { sessionId: string };

    await this.connection.send("Page.enable", {}, response.sessionId);
    await this.connection.send("Runtime.enable", {}, response.sessionId);
    await this.connection.send(
      "Page.setLifecycleEventsEnabled",
      { enabled: true },
      response.sessionId,
    );

    const state: CdpPageState = {
      targetId,
      sessionId: response.sessionId,
      currentUrl: initialUrl,
    };

    const page = new CdpPageHandle(this.connection, state);
    await page.waitForTimeout(50);
    await page.refreshUrl();

    this.pages.set(targetId, state);
    return state;
  }
}

function connectionModeFromProfile(
  startupProfile: StartupProfile,
  endpointKind?: "ws" | "http",
): ConnectionMode {
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

export class CdpCodeTool implements CoreTool {
  readonly id = "cdp_code";
  readonly surface = "code";
  readonly family = "cdp";
  readonly supportedStartupProfiles: StartupProfile[] = [
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
  ];

  async start(input: ToolStartInput): Promise<ToolStartResult> {
    if (!input.providedEndpoint) {
      throw new Error(
        `cdp_code startup profile "${input.startupProfile}" requires a providedEndpoint`,
      );
    }

    const session = await CdpSession.connect({
      providedEndpoint: input.providedEndpoint,
    });

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
          input.providedEndpoint.kind,
        ),
        startupProfile: input.startupProfile,
      },
    };
  }
}
