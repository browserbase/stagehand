/**
 * Stagehand Extension - Background Service Worker
 *
 * Manages chrome.debugger attachment to tabs and proxies CDP commands/events
 * between the sidebar panel and the browser's debugging protocol.
 *
 * Architecture (inspired by playwriter):
 * - chrome.debugger.attach() to connect to a tab's CDP target
 * - chrome.debugger.sendCommand() to forward CDP methods
 * - chrome.debugger.onEvent to receive CDP events and forward to sidebar
 * - Synthetic session IDs to multiplex multiple tabs
 * - Tab activation tracking to keep sidebar in sync with foreground tab
 */

import type {
  TabInfo,
  TabStateMessage,
  CdpCommandResponse,
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

// ──────────────────────────────────────────────────────────
// Messaging helpers
// ──────────────────────────────────────────────────────────

function broadcastToSidebar(message: TabStateMessage | CdpEventMessage | CdpCommandResponse): void {
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
// Tab attachment (chrome.debugger)
// ──────────────────────────────────────────────────────────

function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return false;
  const restrictedPrefixes = [
    "chrome://",
    "chrome-extension://",
    "devtools://",
    "edge://",
    "about:",
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

  // Clean up child sessions for this tab
  for (const [childSessionId, parent] of childSessions.entries()) {
    if (parent.tabId === tabId) {
      broadcastToSidebar({
        type: "cdp-event",
        tabId,
        method: "Target.detachedFromTarget",
        params: { sessionId: childSessionId, targetId: parent.targetId },
      });
      childSessions.delete(childSessionId);
    }
  }

  // Emit detach event for the main session
  if (tab.sessionId && tab.targetId) {
    broadcastToSidebar({
      type: "cdp-event",
      tabId,
      method: "Target.detachedFromTarget",
      params: { sessionId: tab.sessionId, targetId: tab.targetId },
    });
  }

  tabs.delete(tabId);
  chrome.debugger.detach({ tabId }).catch(() => {});
  sendTabState();
}

// ──────────────────────────────────────────────────────────
// CDP command handling
// ──────────────────────────────────────────────────────────

function resolveTabForSession(sessionId: string | undefined): { tabId: number; tab: TabInfo } | undefined {
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
  if (method === "Target.setAutoAttach" && !sessionId) {
    autoAttachParams = params ?? null;
    const attachedTabIds = Array.from(tabs.entries())
      .filter(([, info]) => info.state === "attached")
      .map(([id]) => id);

    await Promise.all(
      attachedTabIds.map(async (id) => {
        try {
          await chrome.debugger.sendCommand({ tabId: id }, "Target.setAutoAttach", params);
        } catch {
          // Non-fatal per-tab failure
        }
      })
    );
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

  // Build a debugger target, optionally scoped to a child session.
  // chrome.debugger.sendCommand accepts { tabId, sessionId? } at runtime,
  // even though the TS type for Debuggee doesn't declare sessionId.
  const childSessionId = sessionId !== tab.sessionId ? sessionId : undefined;
  const target = childSessionId
    ? { tabId, sessionId: childSessionId } as chrome.debugger.Debuggee
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

  // Forward to sidebar with the correct session ID
  broadcastToSidebar({
    type: "cdp-event",
    tabId,
    sessionId: (source as { sessionId?: string }).sessionId || tab.sessionId,
    method,
    params,
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

  // Toggle: if already attached, detach; otherwise attach
  const existing = tabs.get(tab.id);
  if (existing?.state === "attached") {
    // Already attached, sidebar will just show it
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
// Sidebar port communication
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

      case "cdp-command": {
        try {
          const result = await handleCdpCommand(
            msg.tabId,
            msg.sessionId,
            msg.method,
            msg.params
          );
          broadcastToSidebar({
            type: "cdp-response",
            id: msg.id,
            result,
          });
        } catch (err: unknown) {
          broadcastToSidebar({
            type: "cdp-response",
            id: msg.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
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
// Register CDP event listeners
// ──────────────────────────────────────────────────────────

chrome.debugger.onEvent.addListener(onDebuggerEvent);
chrome.debugger.onDetach.addListener(onDebuggerDetach);

// Initialize: get current active tab
chrome.tabs.query({ active: true, currentWindow: true }).then((activeTabs) => {
  if (activeTabs[0]?.id) {
    activeTabId = activeTabs[0].id;
  }
});

console.log("[stagehand] Background service worker started");
