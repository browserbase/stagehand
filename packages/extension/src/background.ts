/**
 * Stagehand Extension - Background Service Worker
 *
 * Connects to the Stagehand server's WebSocket relay and proxies CDP
 * commands/events between the server and the browser's debugging protocol.
 *
 * Architecture:
 * - WebSocket connection to ws://<host>:<port>/v4/extension (relay)
 * - Receives CDP commands from the relay, executes via chrome.debugger
 * - Forwards CDP events from chrome.debugger back to the relay
 * - Sidebar communication via chrome.runtime.Port for UI state only
 */

import type {
  TabInfo,
  TabStateMessage,
  CdpEventMessage,
  SidebarMessage,
} from "./types.js";

// ──────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────

/** Attached tabs and their CDP session info */
const tabs = new Map<number, TabInfo>();

/** Currently active (foreground) tab */
let activeTabId: number | undefined;

/** Monotonic counter for synthetic session IDs */
let nextSessionId = 1;

/** Scope prefix to make session IDs unique across extension restarts */
const sessionScope = (() => {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return Array.from(values)
    .map((v) => v.toString(36))
    .join("");
})();

/** Map child session IDs → parent tabId (for OOPIF frames) */
const childSessions = new Map<string, { tabId: number; targetId?: string }>();

/** Cached Target.setAutoAttach params to apply to newly attached tabs */
let autoAttachParams: Record<string, unknown> | null = null;

/** Ports from the sidebar panel */
const sidebarPorts = new Set<chrome.runtime.Port>();

/** WebSocket connection to the relay server */
let ws: WebSocket | null = null;

/** Whether we intentionally closed the WebSocket (skip reconnect) */
let wsIntentionallyClosed = false;

/** Current reconnect attempt count for exponential backoff */
let reconnectAttempt = 0;

/** Handle for the pending reconnect timer */
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

// ──────────────────────────────────────────────────────────
// Sidebar messaging helpers
// ──────────────────────────────────────────────────────────

function broadcastToSidebar(message: TabStateMessage | CdpEventMessage): void {
  const json = JSON.stringify(message, (_key, value) => {
    if (value instanceof Map) return Array.from(value.entries());
    return value;
  });
  for (const port of sidebarPorts) {
    try {
      port.postMessage(JSON.parse(json));
    } catch {
      sidebarPorts.delete(port);
    }
  }
}

function sendTabState(): void {
  broadcastToSidebar({
    type: "tab-state",
    activeTabId,
    tabs: Array.from(tabs.entries()),
  });
}

// ──────────────────────────────────────────────────────────
// WebSocket relay connection
// ──────────────────────────────────────────────────────────

/** Send a JSON message over the WebSocket if connected */
function wsSend(message: Record<string, unknown>): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

/** Read server host/port from chrome.storage.local */
async function getServerConfig(): Promise<{ host: string; port: number }> {
  const result = await chrome.storage.local.get(["serverHost", "serverPort"]);
  return {
    host: result.serverHost || "127.0.0.1",
    port: result.serverPort || 3000,
  };
}

/** Connect (or reconnect) to the relay WebSocket */
async function connectWebSocket(): Promise<void> {
  // Clean up any existing connection
  if (ws) {
    wsIntentionallyClosed = true;
    ws.close();
    ws = null;
  }

  wsIntentionallyClosed = false;

  const { host, port } = await getServerConfig();
  const url = `ws://${host}:${port}/v4/extension`;

  console.log(`[stagehand] Connecting to relay: ${url}`);

  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error("[stagehand] WebSocket constructor error:", err);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log("[stagehand] WebSocket connected to relay");
    reconnectAttempt = 0;
  };

  ws.onmessage = (event) => {
    let msg: { id?: number; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(event.data as string);
    } catch {
      console.error("[stagehand] Invalid JSON from relay:", event.data);
      return;
    }
    handleRelayMessage(msg);
  };

  ws.onclose = () => {
    console.log("[stagehand] WebSocket closed");
    ws = null;
    if (!wsIntentionallyClosed) {
      scheduleReconnect();
    }
  };

  ws.onerror = (err) => {
    console.error("[stagehand] WebSocket error:", err);
    // onclose will fire after onerror, which handles reconnection
  };
}

/** Schedule a reconnection with exponential backoff */
function scheduleReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempt), 30000);
  reconnectAttempt++;
  console.log(
    `[stagehand] Reconnecting in ${delay}ms (attempt ${reconnectAttempt})`
  );
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, delay);
}

// ──────────────────────────────────────────────────────────
// Tab attachment (chrome.debugger)
// ──────────────────────────────────────────────────────────

function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return false;
  const restrictedPrefixes = [
    "chrome://",
    "chrome-extension://",
    "devtools://",
    "edge://",
    "https://chrome.google.com/",
    "https://chromewebstore.google.com/",
  ];
  return restrictedPrefixes.some((prefix) => url.startsWith(prefix));
}

async function attachTab(tabId: number): Promise<TabInfo> {
  const debuggee: chrome.debugger.Debuggee = { tabId };

  tabs.set(tabId, { state: "attaching" });
  sendTabState();

  let debuggerAttached = false;

  try {
    // Attach the Chrome debugger to this tab
    await chrome.debugger.attach(debuggee, "1.3");
    debuggerAttached = true;

    // Enable Page domain for navigation events
    await chrome.debugger.sendCommand(debuggee, "Page.enable");

    // If we have cached auto-attach params, apply them for OOPIF support
    if (autoAttachParams) {
      try {
        await chrome.debugger.sendCommand(
          debuggee,
          "Target.setAutoAttach",
          autoAttachParams
        );
      } catch {
        // Non-fatal
      }
    }

    // Get target info for this tab
    const result = (await chrome.debugger.sendCommand(
      debuggee,
      "Target.getTargetInfo"
    )) as { targetInfo: { targetId: string; url: string; type: string } };

    const sessionId = `sh-tab-${sessionScope}-${nextSessionId++}`;

    const info: TabInfo = {
      state: "attached",
      sessionId,
      targetId: result.targetInfo.targetId,
    };

    tabs.set(tabId, info);
    sendTabState();

    console.log(
      `[stagehand] Attached to tab ${tabId}, sessionId=${sessionId}, targetId=${result.targetInfo.targetId}`
    );

    return info;
  } catch (error: unknown) {
    if (debuggerAttached) {
      chrome.debugger.detach(debuggee).catch(() => {});
    }

    const errorText =
      error instanceof Error ? error.message : String(error);
    const info: TabInfo = { state: "error", errorText };
    tabs.set(tabId, info);
    sendTabState();
    throw error;
  }
}

function detachTab(tabId: number): void {
  const tab = tabs.get(tabId);
  if (!tab) return;

  console.log(`[stagehand] Detaching tab ${tabId}`);

  // Clean up child sessions for this tab and notify via WebSocket
  for (const [childSessionId, parent] of childSessions.entries()) {
    if (parent.tabId === tabId) {
      const detachEvent: CdpEventMessage = {
        type: "cdp-event",
        tabId,
        method: "Target.detachedFromTarget",
        params: { sessionId: childSessionId, targetId: parent.targetId },
      };
      broadcastToSidebar(detachEvent);
      wsSend({
        method: "forwardCDPEvent",
        params: {
          method: "Target.detachedFromTarget",
          sessionId: childSessionId,
          params: { sessionId: childSessionId, targetId: parent.targetId },
        },
      });
      childSessions.delete(childSessionId);
    }
  }

  // Emit detach event for the main session
  if (tab.sessionId && tab.targetId) {
    const detachEvent: CdpEventMessage = {
      type: "cdp-event",
      tabId,
      method: "Target.detachedFromTarget",
      params: { sessionId: tab.sessionId, targetId: tab.targetId },
    };
    broadcastToSidebar(detachEvent);
    wsSend({
      method: "forwardCDPEvent",
      params: {
        method: "Target.detachedFromTarget",
        sessionId: tab.sessionId,
        params: { sessionId: tab.sessionId, targetId: tab.targetId },
      },
    });
  }

  tabs.delete(tabId);
  chrome.debugger.detach({ tabId }).catch(() => {});
  sendTabState();
}

// ──────────────────────────────────────────────────────────
// CDP command handling (shared by relay and sidebar)
// ──────────────────────────────────────────────────────────

function resolveTabForSession(
  sessionId: string | undefined
): { tabId: number; tab: TabInfo } | undefined {
  if (!sessionId) return undefined;

  // Check main tab sessions
  for (const [tabId, tab] of tabs) {
    if (tab.sessionId === sessionId) return { tabId, tab };
  }

  // Check child sessions
  const child = childSessions.get(sessionId);
  if (child) {
    const tab = tabs.get(child.tabId);
    if (tab) return { tabId: child.tabId, tab };
  }

  return undefined;
}

/** Get the primary attached tab (active tab if attached, otherwise first attached) */
function getPrimaryAttachedTab(): { tabId: number; tab: TabInfo } | undefined {
  // Prefer the active tab if it's attached
  if (activeTabId !== undefined) {
    const tab = tabs.get(activeTabId);
    if (tab && tab.state === "attached") {
      return { tabId: activeTabId, tab };
    }
  }

  // Fall back to the first attached tab
  for (const [tabId, tab] of tabs) {
    if (tab.state === "attached") {
      return { tabId, tab };
    }
  }

  return undefined;
}

async function handleCdpCommand(
  tabId: number,
  sessionId: string | undefined,
  method: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  const tab = tabs.get(tabId);
  if (!tab || tab.state !== "attached") {
    throw new Error(`Tab ${tabId} is not attached`);
  }

  const debuggee: chrome.debugger.Debuggee = { tabId };

  // Handle Target.setAutoAttach at root level - apply to all attached tabs
  // and synthesize Target.attachedToTarget events for existing targets
  if (method === "Target.setAutoAttach" && !sessionId) {
    autoAttachParams = params ?? null;
    const attachedTabIds = Array.from(tabs.entries())
      .filter(([, info]) => info.state === "attached")
      .map(([id]) => id);

    await Promise.all(
      attachedTabIds.map(async (id) => {
        try {
          await chrome.debugger.sendCommand(
            { tabId: id },
            "Target.setAutoAttach",
            params
          );
        } catch {
          // Non-fatal per-tab failure
        }
      })
    );

    // Synthesize Target.attachedToTarget events for all attached tabs
    for (const [tid, info] of tabs) {
      if (info.state === "attached" && info.targetId && info.sessionId) {
        try {
          const chromeTab = await chrome.tabs.get(tid);
          wsSend({
            method: "forwardCDPEvent",
            params: {
              method: "Target.attachedToTarget",
              params: {
                sessionId: info.sessionId,
                targetInfo: {
                  targetId: info.targetId,
                  type: "page",
                  title: chromeTab.title || "",
                  url: chromeTab.url || "",
                  attached: true,
                  canAccessOpener: false,
                },
                waitingForDebugger: !!(params?.waitForDebuggerOnStart),
              },
            },
          });
        } catch {
          // Tab may have been closed
        }
      }
    }

    return {};
  }

  // Handle Target.createTarget → chrome.tabs.create
  if (method === "Target.createTarget") {
    const url = (params?.url as string) || "about:blank";
    const newTab = await chrome.tabs.create({ url, active: false });
    if (!newTab.id) throw new Error("Failed to create tab");
    const info = await attachTab(newTab.id);
    return { targetId: info.targetId };
  }

  // Handle Target.closeTarget → chrome.tabs.remove
  if (method === "Target.closeTarget") {
    const targetId = params?.targetId as string | undefined;
    if (targetId) {
      for (const [tid, info] of tabs) {
        if (info.targetId === targetId) {
          await chrome.tabs.remove(tid);
          return { success: true };
        }
      }
    }
    return { success: false };
  }

  // Handle Target.setDiscoverTargets → no-op (not supported by chrome.debugger)
  if (method === "Target.setDiscoverTargets") {
    return {};
  }

  // Handle Target.attachToTarget → find the tab with matching targetId
  if (method === "Target.attachToTarget") {
    const targetId = params?.targetId as string | undefined;
    if (targetId) {
      for (const [tid, info] of tabs) {
        if (info.targetId === targetId && info.sessionId) {
          // Synthesize Target.attachedToTarget event
          try {
            const chromeTab = await chrome.tabs.get(tid);
            wsSend({
              method: "forwardCDPEvent",
              params: {
                method: "Target.attachedToTarget",
                params: {
                  sessionId: info.sessionId,
                  targetInfo: {
                    targetId: info.targetId,
                    type: "page",
                    title: chromeTab.title || "",
                    url: chromeTab.url || "",
                    attached: true,
                    canAccessOpener: false,
                  },
                  waitingForDebugger: false,
                },
              },
            });
          } catch {
            // Tab may have been closed
          }
          return { sessionId: info.sessionId };
        }
      }
    }
    return {};
  }

  // Handle Target.activateTarget → no-op
  if (method === "Target.activateTarget") {
    return {};
  }

  // Handle Runtime.runIfWaitingForDebugger → no-op
  if (method === "Runtime.runIfWaitingForDebugger") {
    return {};
  }

  // Handle Target.getTargets → return info about attached tabs
  if (method === "Target.getTargets") {
    const targetInfos: Array<{
      targetId: string;
      type: string;
      title: string;
      url: string;
      attached: boolean;
    }> = [];

    for (const [tid, info] of tabs) {
      if (info.state === "attached" && info.targetId) {
        try {
          const chromeTab = await chrome.tabs.get(tid);
          targetInfos.push({
            targetId: info.targetId,
            type: "page",
            title: chromeTab.title || "",
            url: chromeTab.url || "",
            attached: true,
          });
        } catch {
          // Tab may have been closed
        }
      }
    }

    return { targetInfos };
  }

  // Build a debugger target, optionally scoped to a child session.
  const childSessionId = sessionId !== tab.sessionId ? sessionId : undefined;
  const target = childSessionId
    ? ({ tabId, sessionId: childSessionId } as chrome.debugger.Debuggee)
    : debuggee;

  // For Runtime.enable, reset first to ensure contexts are re-sent
  if (method === "Runtime.enable") {
    try {
      await chrome.debugger.sendCommand(target, "Runtime.disable");
    } catch {
      // Ignore
    }
    return await chrome.debugger.sendCommand(target, "Runtime.enable", params);
  }

  // Default: forward the CDP command directly
  return await chrome.debugger.sendCommand(target, method, params);
}

// ──────────────────────────────────────────────────────────
// Relay message handling
// ──────────────────────────────────────────────────────────

async function handleRelayMessage(msg: {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
}): Promise<void> {
  if (msg.method !== "forwardCDPCommand" || msg.id === undefined) {
    return;
  }

  const cdpMethod = msg.params?.method as string | undefined;
  const cdpSessionId = msg.params?.sessionId as string | undefined;
  const cdpParams = msg.params?.params as Record<string, unknown> | undefined;

  if (!cdpMethod) {
    wsSend({ id: msg.id, error: "Missing CDP method" });
    return;
  }

  try {
    // Resolve which tab to target
    let tabId: number | undefined;

    if (cdpSessionId) {
      const resolved = resolveTabForSession(cdpSessionId);
      if (resolved) {
        tabId = resolved.tabId;
      }
    }

    // If no session match, use the primary attached tab
    if (tabId === undefined) {
      let primary = getPrimaryAttachedTab();

      // Auto-attach to the active tab if nothing is attached yet
      if (!primary && activeTabId !== undefined) {
        try {
          const chromeTab = await chrome.tabs.get(activeTabId);
          if (chromeTab && !isRestrictedUrl(chromeTab.url)) {
            await attachTab(activeTabId);
            primary = getPrimaryAttachedTab();
          }
        } catch {
          // Tab may not exist
        }
      }

      // If still no attached tab, try to find any non-restricted tab
      if (!primary) {
        try {
          const allTabs = await chrome.tabs.query({});
          const candidate = allTabs.find(
            (t) => t.id && !isRestrictedUrl(t.url)
          );
          if (candidate?.id) {
            await attachTab(candidate.id);
            primary = getPrimaryAttachedTab();
          }
        } catch {
          // Ignore
        }
      }

      if (!primary) {
        wsSend({ id: msg.id, error: "No attached tab available" });
        return;
      }
      tabId = primary.tabId;
    }

    const result = await handleCdpCommand(
      tabId,
      cdpSessionId,
      cdpMethod,
      cdpParams
    );
    wsSend({ id: msg.id, result: result ?? {} });
  } catch (err: unknown) {
    wsSend({
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ──────────────────────────────────────────────────────────
// CDP event forwarding
// ──────────────────────────────────────────────────────────

function onDebuggerEvent(
  source: chrome.debugger.Debuggee,
  method: string,
  params: unknown
): void {
  const tabId = source.tabId;
  if (!tabId) return;

  const tab = tabs.get(tabId);
  if (!tab) return;

  // Track child session attachments (OOPIF frames)
  if (method === "Target.attachedToTarget") {
    const p = params as {
      sessionId?: string;
      targetInfo?: { targetId?: string };
    };
    if (p?.sessionId) {
      childSessions.set(p.sessionId, {
        tabId,
        targetId: p.targetInfo?.targetId,
      });
    }
  }

  // Track child session detachments
  if (method === "Target.detachedFromTarget") {
    const p = params as { sessionId?: string };
    if (p?.sessionId) {
      childSessions.delete(p.sessionId);
    }
  }

  const eventSessionId =
    (source as { sessionId?: string }).sessionId || tab.sessionId;

  // Forward to sidebar for UI
  broadcastToSidebar({
    type: "cdp-event",
    tabId,
    sessionId: eventSessionId,
    method,
    params,
  });

  // Forward to relay server via WebSocket
  wsSend({
    method: "forwardCDPEvent",
    params: {
      method,
      sessionId: eventSessionId,
      params,
    },
  });
}

function onDebuggerDetach(
  source: chrome.debugger.Debuggee,
  reason: string
): void {
  const tabId = source.tabId;
  if (!tabId || !tabs.has(tabId)) return;

  console.log(
    `[stagehand] Debugger detached from tab ${tabId}, reason: ${reason}`
  );

  // Clean up state
  for (const [childId, parent] of childSessions.entries()) {
    if (parent.tabId === tabId) childSessions.delete(childId);
  }

  tabs.delete(tabId);
  sendTabState();
}

// ──────────────────────────────────────────────────────────
// Tab activation tracking
// ──────────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
  sendTabState();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabs.has(tabId)) {
    detachTab(tabId);
  }
  if (activeTabId === tabId) {
    activeTabId = undefined;
    sendTabState();
  }
});

// ──────────────────────────────────────────────────────────
// Extension action (toolbar icon) → open sidebar + attach
// ──────────────────────────────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  // Open the side panel
  if (tab.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }

  if (!tab.id) return;

  // If this tab is restricted, don't try to attach
  if (isRestrictedUrl(tab.url)) return;

  // If already attached, nothing to do
  const existing = tabs.get(tab.id);
  if (existing?.state === "attached") {
    return;
  }

  // Attach to the tab
  try {
    await attachTab(tab.id);
  } catch (err) {
    console.error("[stagehand] Failed to attach:", err);
  }
});

// ──────────────────────────────────────────────────────────
// Sidebar port communication (UI state only, no CDP proxying)
// ──────────────────────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "stagehand-sidebar") return;

  sidebarPorts.add(port);
  console.log("[stagehand] Sidebar connected");

  // Send current state immediately
  sendTabState();

  port.onMessage.addListener(async (msg: SidebarMessage) => {
    switch (msg.type) {
      case "get-state": {
        sendTabState();
        break;
      }

      case "attach-tab": {
        try {
          await attachTab(msg.tabId);
        } catch (err) {
          console.error("[stagehand] Attach failed:", err);
        }
        break;
      }

      case "detach-tab": {
        detachTab(msg.tabId);
        break;
      }
    }
  });

  port.onDisconnect.addListener(() => {
    sidebarPorts.delete(port);
    console.log("[stagehand] Sidebar disconnected");
  });
});

// ──────────────────────────────────────────────────────────
// Listen for config changes and reconnect
// ──────────────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (changes.serverHost || changes.serverPort) {
    console.log("[stagehand] Server config changed, reconnecting WebSocket");
    reconnectAttempt = 0;
    connectWebSocket();
  }
});

// ──────────────────────────────────────────────────────────
// Register CDP event listeners and initialize
// ──────────────────────────────────────────────────────────

chrome.debugger.onEvent.addListener(onDebuggerEvent);
chrome.debugger.onDetach.addListener(onDebuggerDetach);

// Initialize: get current active tab
chrome.tabs.query({ active: true, currentWindow: true }).then((activeTabs) => {
  if (activeTabs[0]?.id) {
    activeTabId = activeTabs[0].id;
  }
});

// Start the WebSocket connection to the relay server
connectWebSocket();

console.log("[stagehand] Background service worker started");
