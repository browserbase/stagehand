/**
 * Stagehand Extension - Sidebar Panel Script
 *
 * Runs in the side panel context. Connects to the background service worker
 * via chrome.runtime.Port for tab state (attach/detach status), and calls
 * the stagehand server's HTTP API for act/observe/extract/agent operations.
 */

import type {
  TabInfo,
  TabStateMessage,
  StagehandAction,
  ChatMessage,
} from "./types.js";

// ──────────────────────────────────────────────────────────
// DOM Elements
// ──────────────────────────────────────────────────────────

const statusDot = document.getElementById("statusDot")!;
const tabInfoEl = document.getElementById("tabInfo")!;
const attachPrompt = document.getElementById("attachPrompt")!;
const chatSection = document.getElementById("chatSection")!;
const chatContainer = document.getElementById("chatContainer")!;
const promptInput = document.getElementById("promptInput") as HTMLInputElement;
const sendBtn = document.getElementById("sendBtn")!;
const attachBtn = document.getElementById("attachBtn")!;
const apiKeyInput = document.getElementById("apiKeyInput") as HTMLInputElement;
const serverHostInput = document.getElementById("serverHostInput") as HTMLInputElement;
const serverPortInput = document.getElementById("serverPortInput") as HTMLInputElement;

const actionButtons = document.querySelectorAll<HTMLButtonElement>(".action-btn");

// ──────────────────────────────────────────────────────────
// State
// ──────────────────────────────────────────────────────────

let currentAction: StagehandAction = "agent";
let activeTabId: number | undefined;
let tabsMap = new Map<number, TabInfo>();
let messages: ChatMessage[] = [];
let isProcessing = false;
let nextMsgId = 1;

/** The current stagehand session ID from the server */
let currentSessionId: string | undefined;

/** Server connection settings */
let serverHost = "127.0.0.1";
let serverPort = 3000;

// ──────────────────────────────────────────────────────────
// Connect to background service worker
// ──────────────────────────────────────────────────────────

const port = chrome.runtime.connect({ name: "stagehand-sidebar" });

port.onMessage.addListener((msg: TabStateMessage) => {
  if (msg.type === "tab-state") {
    handleTabState(msg);
  }
});

// Request initial state
port.postMessage({ type: "get-state" });

// ──────────────────────────────────────────────────────────
// Persisted settings
// ──────────────────────────────────────────────────────────

chrome.storage.local.get(
  ["modelApiKey", "serverHost", "serverPort"],
  (result) => {
    if (result.modelApiKey) {
      apiKeyInput.value = result.modelApiKey;
    }
    if (result.serverHost) {
      serverHost = result.serverHost;
      serverHostInput.value = serverHost;
    }
    if (result.serverPort) {
      serverPort = Number(result.serverPort);
      serverPortInput.value = String(serverPort);
    }
  }
);

apiKeyInput.addEventListener("change", () => {
  chrome.storage.local.set({ modelApiKey: apiKeyInput.value });
});

serverHostInput.addEventListener("change", () => {
  serverHost = serverHostInput.value.trim() || "127.0.0.1";
  serverHostInput.value = serverHost;
  chrome.storage.local.set({ serverHost });
});

serverPortInput.addEventListener("change", () => {
  serverPort = Number(serverPortInput.value) || 3000;
  serverPortInput.value = String(serverPort);
  chrome.storage.local.set({ serverPort });
});

// ──────────────────────────────────────────────────────────
// Server API helpers
// ──────────────────────────────────────────────────────────

function getBaseUrl(): string {
  return `http://${serverHost}:${serverPort}`;
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-stagehand-api-key": "extension",
  };
  const apiKey = apiKeyInput.value.trim();
  if (apiKey) {
    headers["x-model-api-key"] = apiKey;
  }
  return headers;
}

async function serverFetch(
  path: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const url = `${getBaseUrl()}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Server error (${response.status}): ${text}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  return response.text();
}

// ──────────────────────────────────────────────────────────
// Session management
// ──────────────────────────────────────────────────────────

async function startSession(): Promise<string> {
  const cdpUrl = `ws://${serverHost}:${serverPort}/v4/cdp`;

  const result = (await serverFetch("/v4/sessions/start", {
    browser: {
      type: "local",
      cdpUrl,
    },
    modelApiKey: apiKeyInput.value.trim(),
  })) as { sessionId: string };

  return result.sessionId;
}

async function endSession(sessionId: string): Promise<void> {
  try {
    await serverFetch(`/v4/sessions/${sessionId}/end`, {});
  } catch {
    // Best-effort cleanup; ignore errors
  }
}

async function ensureSession(): Promise<string> {
  if (!currentSessionId) {
    currentSessionId = await startSession();
  }
  return currentSessionId;
}

async function resetSession(): Promise<void> {
  if (currentSessionId) {
    const old = currentSessionId;
    currentSessionId = undefined;
    await endSession(old);
  }
}

// ──────────────────────────────────────────────────────────
// Tab state handling
// ──────────────────────────────────────────────────────────

async function handleTabState(msg: TabStateMessage): Promise<void> {
  const prevTabId = activeTabId;
  const wasAttached = isAttached();

  activeTabId = msg.activeTabId;
  tabsMap = new Map(msg.tabs);

  const nowAttached = isAttached();

  // If we switched tabs or re-attached, reset the session
  if (nowAttached && (activeTabId !== prevTabId || (!wasAttached && nowAttached))) {
    await resetSession();
  }

  updateUI();
}

function getActiveTabInfo(): TabInfo | undefined {
  if (activeTabId === undefined) return undefined;
  return tabsMap.get(activeTabId);
}

function isAttached(): boolean {
  const info = getActiveTabInfo();
  return info?.state === "attached";
}

// ──────────────────────────────────────────────────────────
// UI Updates
// ──────────────────────────────────────────────────────────

function updateUI(): void {
  const info = getActiveTabInfo();
  const attached = info?.state === "attached";

  // Status dot
  statusDot.className = "status-dot" + (attached ? " attached" : "");

  // Tab info
  if (attached && activeTabId !== undefined) {
    tabInfoEl.textContent = `Tab ${activeTabId} attached`;
  } else if (activeTabId !== undefined) {
    tabInfoEl.textContent = `Tab ${activeTabId} (not attached)`;
  } else {
    tabInfoEl.textContent = "No tab attached";
  }

  // Show/hide attach prompt vs chat
  if (!attached) {
    attachPrompt.style.display = "flex";
    chatSection.style.display = "none";
  } else {
    attachPrompt.style.display = "none";
    chatSection.style.display = "flex";
  }

  // Disable send if processing or not attached
  sendBtn.toggleAttribute("disabled", isProcessing || !attached);
  promptInput.toggleAttribute("disabled", isProcessing || !attached);
}

function renderMessages(): void {
  chatContainer.innerHTML = "";
  for (const msg of messages) {
    const div = document.createElement("div");
    div.className = `message ${msg.role}`;

    let html = "";
    if (msg.action) {
      html += `<span class="action-badge">${msg.action}</span><br/>`;
    }
    if (msg.loading) {
      html += `<span class="loading-dots">Thinking</span>`;
    } else if (msg.result !== undefined) {
      html += escapeHtml(msg.content);
      html += `<pre>${escapeHtml(typeof msg.result === "string" ? msg.result : JSON.stringify(msg.result, null, 2))}</pre>`;
    } else {
      html += escapeHtml(msg.content);
    }

    div.innerHTML = html;
    chatContainer.appendChild(div);
  }
  chatContainer.scrollTop = chatContainer.scrollHeight;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ──────────────────────────────────────────────────────────
// Action button handling
// ──────────────────────────────────────────────────────────

actionButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    currentAction = btn.dataset.action as StagehandAction;
    actionButtons.forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    const placeholders: Record<StagehandAction, string> = {
      act: "e.g., Click the login button",
      observe: "e.g., Find all navigation links",
      extract: "e.g., Extract the article title and content",
      agent: "e.g., Search for flights from NYC to London",
    };
    promptInput.placeholder = placeholders[currentAction] || "Enter instruction...";
  });
});

// ──────────────────────────────────────────────────────────
// Attach button
// ──────────────────────────────────────────────────────────

attachBtn.addEventListener("click", async () => {
  if (activeTabId === undefined) return;
  port.postMessage({ type: "attach-tab", tabId: activeTabId });
});

// ──────────────────────────────────────────────────────────
// Send / Execute
// ──────────────────────────────────────────────────────────

async function handleSend(): Promise<void> {
  const instruction = promptInput.value.trim();
  if (!instruction || isProcessing || !isAttached()) return;

  const action = currentAction;

  // Add user message
  const userMsg: ChatMessage = {
    id: String(nextMsgId++),
    role: "user",
    content: instruction,
    timestamp: Date.now(),
    action,
  };
  messages.push(userMsg);

  // Add loading message
  const assistantMsg: ChatMessage = {
    id: String(nextMsgId++),
    role: "assistant",
    content: "",
    timestamp: Date.now(),
    action,
    loading: true,
  };
  messages.push(assistantMsg);

  promptInput.value = "";
  isProcessing = true;
  updateUI();
  renderMessages();

  try {
    const result = await executeAction(action, instruction);
    assistantMsg.loading = false;
    assistantMsg.content = getResultSummary(action, result);
    assistantMsg.result = result;
  } catch (err: unknown) {
    assistantMsg.loading = false;
    assistantMsg.content = `Error: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    isProcessing = false;
    updateUI();
    renderMessages();
  }
}

function getResultSummary(action: StagehandAction, result: unknown): string {
  switch (action) {
    case "act":
      return "Action completed.";
    case "observe": {
      const actions = result as Array<{ description?: string }>;
      return `Found ${actions.length} observable action(s).`;
    }
    case "extract":
      return "Extracted data:";
    case "agent":
      return "Agent execution completed.";
    default:
      return "Done.";
  }
}

sendBtn.addEventListener("click", handleSend);
promptInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    handleSend();
  }
});

// ──────────────────────────────────────────────────────────
// Execute stagehand actions via server HTTP API
// ──────────────────────────────────────────────────────────

async function executeAction(
  action: StagehandAction,
  instruction: string
): Promise<unknown> {
  if (!activeTabId) throw new Error("No active tab");

  const tabInfo = tabsMap.get(activeTabId);
  if (!tabInfo || tabInfo.state !== "attached") {
    throw new Error("Tab not attached");
  }

  const sessionId = await ensureSession();

  const actionEndpoints: Record<StagehandAction, string> = {
    act: "act",
    observe: "observe",
    extract: "extract",
    agent: "agentExecute",
  };

  const endpoint = actionEndpoints[action];
  if (!endpoint) throw new Error(`Unknown action: ${action}`);

  const body: Record<string, unknown> = { instruction };

  // For extract, the server may expect a schema; send instruction as the schema description
  if (action === "extract") {
    body.instruction = instruction;
  }

  const result = await serverFetch(
    `/v4/sessions/${sessionId}/${endpoint}`,
    body
  );

  return result;
}

// ──────────────────────────────────────────────────────────
// Initial render
// ──────────────────────────────────────────────────────────

updateUI();
