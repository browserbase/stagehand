/**
 * CDP Adapter for the Stagehand Chrome Extension
 *
 * Provides a CDPSessionLike interface (matching understudy's cdp.ts) that
 * communicates over chrome.runtime.Port to the background service worker,
 * which in turn uses chrome.debugger to talk to the actual browser CDP.
 *
 * This allows stagehand/understudy code (which expects a WebSocket-like CDP
 * transport) to work inside a Chrome extension's sidebar panel.
 */

import type {
  CdpCommandRequest,
  CdpCommandResponse,
  CdpEventMessage,
  TabStateMessage,
  BackgroundMessage,
  TabInfo,
} from "./types.js";

/** Matches the CDPSessionLike interface from @browserbasehq/stagehand understudy */
export interface CDPSessionLike {
  send<R = unknown>(method: string, params?: object): Promise<R>;
  on<P = unknown>(event: string, handler: (params: P) => void): void;
  off<P = unknown>(event: string, handler: (params: P) => void): void;
  close(): Promise<void>;
  readonly id: string | null;
}

type EventHandler = (params: unknown) => void;
type InflightRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

/**
 * ExtensionCdpConnection implements CDPSessionLike by proxying all CDP calls
 * through chrome.runtime.Port to the background service worker.
 *
 * It acts as the "root" CDP connection for the currently active tab.
 * Child sessions (for OOPIF frames) are created automatically when
 * Target.attachedToTarget events arrive.
 */
export class ExtensionCdpConnection implements CDPSessionLike {
  private port: chrome.runtime.Port;
  private nextId = 1;
  private inflight = new Map<number, InflightRequest>();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private sessions = new Map<string, ExtensionCdpSession>();
  private _tabId: number;
  private _sessionId: string | null;
  private _closed = false;

  /** Callback when the active tab changes */
  public onActiveTabChanged?: (tabId: number, tabs: Map<number, TabInfo>) => void;
  /** Callback when tab state changes */
  public onTabStateChanged?: (tabs: Map<number, TabInfo>) => void;

  readonly id: string | null = null;

  constructor(port: chrome.runtime.Port, tabId: number, sessionId: string | null) {
    this.port = port;
    this._tabId = tabId;
    this._sessionId = sessionId;

    this.port.onMessage.addListener((msg: BackgroundMessage) => {
      this.onMessage(msg);
    });
  }

  get tabId(): number {
    return this._tabId;
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  /** Update which tab this connection targets (when user switches tabs) */
  setActiveTab(tabId: number, sessionId: string | null): void {
    this._tabId = tabId;
    this._sessionId = sessionId;
  }

  async send<R = unknown>(method: string, params?: object): Promise<R> {
    if (this._closed) throw new Error("Connection closed");

    const id = this.nextId++;
    const request: CdpCommandRequest = {
      type: "cdp-command",
      id,
      tabId: this._tabId,
      sessionId: this._sessionId ?? undefined,
      method,
      params: params as Record<string, unknown>,
    };

    return new Promise<R>((resolve, reject) => {
      this.inflight.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.port.postMessage(request);
    });
  }

  on<P = unknown>(event: string, handler: (params: P) => void): void {
    const set = this.eventHandlers.get(event) ?? new Set<EventHandler>();
    set.add(handler as EventHandler);
    this.eventHandlers.set(event, set);
  }

  off<P = unknown>(event: string, handler: (params: P) => void): void {
    const set = this.eventHandlers.get(event);
    if (set) set.delete(handler as EventHandler);
  }

  async close(): Promise<void> {
    this._closed = true;
    // Reject all inflight requests
    for (const [id, req] of this.inflight) {
      req.reject(new Error("Connection closed"));
      this.inflight.delete(id);
    }
  }

  getSession(sessionId: string): ExtensionCdpSession | undefined {
    return this.sessions.get(sessionId);
  }

  sendViaSession<R = unknown>(
    sessionId: string,
    method: string,
    params?: object
  ): Promise<R> {
    if (this._closed) throw new Error("Connection closed");

    const id = this.nextId++;
    const request: CdpCommandRequest = {
      type: "cdp-command",
      id,
      tabId: this._tabId,
      sessionId,
      method,
      params: params as Record<string, unknown>,
    };

    return new Promise<R>((resolve, reject) => {
      this.inflight.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.port.postMessage(request);
    });
  }

  private onMessage(msg: BackgroundMessage): void {
    if (msg.type === "cdp-response") {
      this.handleResponse(msg as CdpCommandResponse);
    } else if (msg.type === "cdp-event") {
      this.handleEvent(msg as CdpEventMessage);
    } else if (msg.type === "tab-state") {
      this.handleTabState(msg as TabStateMessage);
    }
  }

  private handleResponse(msg: CdpCommandResponse): void {
    const inflight = this.inflight.get(msg.id);
    if (!inflight) return;

    this.inflight.delete(msg.id);

    if (msg.error) {
      inflight.reject(new Error(msg.error));
    } else {
      inflight.resolve(msg.result);
    }
  }

  private handleEvent(msg: CdpEventMessage): void {
    // Only process events for our current tab
    if (msg.tabId !== this._tabId) return;

    const { method, params, sessionId } = msg;

    // Track child sessions
    if (method === "Target.attachedToTarget") {
      const p = params as { sessionId?: string; targetInfo?: { targetId?: string } };
      if (p?.sessionId) {
        const session = new ExtensionCdpSession(this, p.sessionId);
        this.sessions.set(p.sessionId, session);
      }
    }

    if (method === "Target.detachedFromTarget") {
      const p = params as { sessionId?: string };
      if (p?.sessionId) {
        this.sessions.delete(p.sessionId);
      }
    }

    // Dispatch to session-specific handlers first
    if (sessionId && sessionId !== this._sessionId) {
      const session = this.sessions.get(sessionId);
      if (session) {
        session.dispatch(method, params);
      }
      // Also dispatch Target events to root handlers
      if (method.startsWith("Target.")) {
        const handlers = this.eventHandlers.get(method);
        if (handlers) for (const h of handlers) h(params);
      }
      return;
    }

    // Root-level event
    const handlers = this.eventHandlers.get(method);
    if (handlers) for (const h of handlers) h(params);
  }

  private handleTabState(msg: TabStateMessage): void {
    const tabsMap = new Map<number, TabInfo>(msg.tabs);

    // If active tab changed and we have an attached session for it, switch
    if (msg.activeTabId !== undefined && msg.activeTabId !== this._tabId) {
      const tabInfo = tabsMap.get(msg.activeTabId);
      if (tabInfo?.state === "attached" && tabInfo.sessionId) {
        this._tabId = msg.activeTabId;
        this._sessionId = tabInfo.sessionId;
      }
    }

    this.onActiveTabChanged?.(msg.activeTabId ?? this._tabId, tabsMap);
    this.onTabStateChanged?.(tabsMap);
  }
}

/**
 * ExtensionCdpSession wraps a child CDP session (e.g., for OOPIF frames).
 */
export class ExtensionCdpSession implements CDPSessionLike {
  private eventHandlers = new Map<string, Set<EventHandler>>();

  constructor(
    private readonly root: ExtensionCdpConnection,
    public readonly id: string
  ) {}

  send<R = unknown>(method: string, params?: object): Promise<R> {
    return this.root.sendViaSession<R>(this.id, method, params);
  }

  on<P = unknown>(event: string, handler: (params: P) => void): void {
    const set = this.eventHandlers.get(event) ?? new Set<EventHandler>();
    set.add(handler as EventHandler);
    this.eventHandlers.set(event, set);
  }

  off<P = unknown>(event: string, handler: (params: P) => void): void {
    const set = this.eventHandlers.get(event);
    if (set) set.delete(handler as EventHandler);
  }

  async close(): Promise<void> {
    // Send detach command
    await this.root.send("Target.detachFromTarget", {
      sessionId: this.id,
    });
  }

  dispatch(event: string, params: unknown): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) for (const h of handlers) h(params);
  }
}
