/**
 * Types for the Stagehand Chrome extension.
 */

/** State of a tab's debugger attachment */
export type TabState = "idle" | "attaching" | "attached" | "error";

/** Info tracked for each debuggable tab */
export interface TabInfo {
  state: TabState;
  /** Synthetic session ID assigned by the extension, used to multiplex CDP */
  sessionId?: string;
  /** CDP targetId returned by Target.getTargetInfo */
  targetId?: string;
  /** Error message if state is 'error' */
  errorText?: string;
}

/** Overall extension state */
export interface ExtensionState {
  /** Currently active (foreground) tab ID */
  activeTabId: number | undefined;
  /** Map of tabId -> TabInfo for all attached tabs */
  tabs: Map<number, TabInfo>;
  /** Whether the sidebar is open */
  sidebarOpen: boolean;
}

// ──────────────────────────────────────────────────────────
// Messages between background service worker and sidebar
// ──────────────────────────────────────────────────────────

/**
 * Background → Sidebar: CDP command response.
 * Used by the background service worker for responding to CDP commands.
 */
export interface CdpCommandResponse {
  type: "cdp-response";
  id: number;
  result?: unknown;
  error?: string;
}

/**
 * Background → Sidebar: forwarded CDP event.
 * Used by the background service worker for forwarding CDP events.
 */
export interface CdpEventMessage {
  type: "cdp-event";
  tabId: number;
  sessionId?: string;
  method: string;
  params?: unknown;
}

/** Background → Sidebar: tab state changed */
export interface TabStateMessage {
  type: "tab-state";
  activeTabId: number | undefined;
  tabs: [number, TabInfo][];
}

/** Sidebar → Background: request to send a CDP command */
export interface CdpCommandRequest {
  type: "cdp-command";
  id: number;
  tabId: number;
  sessionId?: string;
  method: string;
  params?: Record<string, unknown>;
}

/** Sidebar → Background: attach/detach requests */
export interface AttachRequest {
  type: "attach-tab";
  tabId: number;
}

export interface DetachRequest {
  type: "detach-tab";
  tabId: number;
}

/** Sidebar → Background: get current state */
export interface GetStateRequest {
  type: "get-state";
}

/** Any message from sidebar to background */
export type SidebarMessage =
  | CdpCommandRequest
  | AttachRequest
  | DetachRequest
  | GetStateRequest;

/** Any message from background to sidebar */
export type BackgroundMessage =
  | CdpCommandResponse
  | CdpEventMessage
  | TabStateMessage;

// ──────────────────────────────────────────────────────────
// Chat / AI interface types
// ──────────────────────────────────────────────────────────

export type StagehandAction = "act" | "observe" | "extract" | "agent";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  action?: StagehandAction;
  /** Structured result from stagehand operations */
  result?: unknown;
  loading?: boolean;
}
