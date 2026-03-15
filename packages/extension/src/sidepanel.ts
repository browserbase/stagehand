/**
 * Stagehand Extension - Sidebar Panel Script
 *
 * Runs in the side panel context. Connects to the background service worker
 * via chrome.runtime.Port, provides a chat-like UI for stagehand operations
 * (act, observe, extract, agentExecute), and uses the CDP adapter to proxy
 * commands through chrome.debugger.
 */

import type {
  TabInfo,
  TabStateMessage,
  CdpCommandResponse,
  CdpEventMessage,
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

// ──────────────────────────────────────────────────────────
// Connect to background service worker
// ──────────────────────────────────────────────────────────

const port = chrome.runtime.connect({ name: "stagehand-sidebar" });

port.onMessage.addListener((msg: TabStateMessage | CdpCommandResponse | CdpEventMessage) => {
  if (msg.type === "tab-state") {
    handleTabState(msg);
  }
});

// Request initial state
port.postMessage({ type: "get-state" });

// ──────────────────────────────────────────────────────────
// Persisted API key
// ──────────────────────────────────────────────────────────

chrome.storage.local.get("anthropicApiKey", (result) => {
  if (result.anthropicApiKey) {
    apiKeyInput.value = result.anthropicApiKey;
  }
});

apiKeyInput.addEventListener("change", () => {
  chrome.storage.local.set({ anthropicApiKey: apiKeyInput.value });
});

// ──────────────────────────────────────────────────────────
// Tab state handling
// ──────────────────────────────────────────────────────────

function handleTabState(msg: TabStateMessage): void {
  activeTabId = msg.activeTabId;
  tabsMap = new Map(msg.tabs);
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
  // Keep system intro message, replace rest
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

    // Update placeholder based on action
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
  const apiKey = apiKeyInput.value.trim();

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
    const result = await executeAction(action, instruction, apiKey);
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
// Execute stagehand actions via CDP
// ──────────────────────────────────────────────────────────

/**
 * Execute a stagehand action by sending CDP commands through the
 * background service worker. This uses Anthropic's API directly
 * from the extension context.
 *
 * For act/observe/extract we use the Stagehand API approach:
 * 1. Take a screenshot of the page via CDP
 * 2. Send it to the Anthropic API with the instruction
 * 3. Execute the resulting actions via CDP
 *
 * For agent mode, we run a multi-step loop.
 */
async function executeAction(
  action: StagehandAction,
  instruction: string,
  apiKey: string
): Promise<unknown> {
  if (!activeTabId) throw new Error("No active tab");

  const tabInfo = tabsMap.get(activeTabId);
  if (!tabInfo || tabInfo.state !== "attached") {
    throw new Error("Tab not attached");
  }

  // Take a screenshot via CDP
  const screenshotResult = await sendCdpCommand(
    "Page.captureScreenshot",
    { format: "png" }
  );
  const screenshot = (screenshotResult as { data: string }).data;

  switch (action) {
    case "act":
      return executeAct(instruction, screenshot, apiKey);
    case "observe":
      return executeObserve(instruction, screenshot, apiKey);
    case "extract":
      return executeExtract(instruction, screenshot, apiKey);
    case "agent":
      return executeAgent(instruction, screenshot, apiKey);
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}

async function sendCdpCommand(
  method: string,
  params?: Record<string, unknown>
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = nextMsgId++;
    const handler = (msg: { type: string; id?: number; result?: unknown; error?: string }) => {
      if (msg.type === "cdp-response" && msg.id === id) {
        port.onMessage.removeListener(handler);
        if (msg.error) reject(new Error(msg.error));
        else resolve(msg.result);
      }
    };
    port.onMessage.addListener(handler);
    port.postMessage({
      type: "cdp-command",
      id,
      tabId: activeTabId,
      method,
      params,
    });
  });
}

/**
 * Call the Anthropic API with a screenshot and instruction.
 * Uses claude-sonnet-4-20250514 for efficiency.
 */
async function callAnthropicAPI(
  instruction: string,
  screenshot: string,
  systemPrompt: string,
  apiKey: string
): Promise<string> {
  if (!apiKey) {
    throw new Error("Please enter your Anthropic API key in the settings bar above.");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: screenshot,
              },
            },
            {
              type: "text",
              text: instruction,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${err}`);
  }

  const data = await response.json();
  const content = data.content?.[0];
  return content?.text || JSON.stringify(data.content);
}

async function executeAct(
  instruction: string,
  screenshot: string,
  apiKey: string
): Promise<unknown> {
  const systemPrompt = `You are a browser automation assistant. The user wants you to perform an action on the current webpage.
Look at the screenshot and determine what DOM action to perform to accomplish the user's instruction.
Return a JSON object with the action to take:
{
  "action": "click" | "type" | "scroll" | "navigate",
  "selector": "CSS selector for the element",
  "value": "text to type (for type action) or URL (for navigate)",
  "description": "brief description of what you're doing"
}
Return ONLY the JSON, no other text.`;

  const response = await callAnthropicAPI(instruction, screenshot, systemPrompt, apiKey);

  try {
    const parsed = JSON.parse(response);

    // Execute the action via CDP
    switch (parsed.action) {
      case "click": {
        // Find the element and click it
        const nodeResult = await sendCdpCommand("Runtime.evaluate", {
          expression: `document.querySelector('${parsed.selector.replace(/'/g, "\\'")}')?.getBoundingClientRect()`,
          returnByValue: true,
        });
        const rect = (nodeResult as { result?: { value?: DOMRect } })?.result?.value;
        if (rect) {
          const x = rect.x + rect.width / 2;
          const y = rect.y + rect.height / 2;
          await sendCdpCommand("Input.dispatchMouseEvent", {
            type: "mousePressed",
            x,
            y,
            button: "left",
            clickCount: 1,
          });
          await sendCdpCommand("Input.dispatchMouseEvent", {
            type: "mouseReleased",
            x,
            y,
            button: "left",
            clickCount: 1,
          });
        }
        break;
      }
      case "type": {
        // Focus element then type
        await sendCdpCommand("Runtime.evaluate", {
          expression: `document.querySelector('${parsed.selector.replace(/'/g, "\\'")}')?.focus()`,
        });
        for (const char of parsed.value || "") {
          await sendCdpCommand("Input.dispatchKeyEvent", {
            type: "keyDown",
            text: char,
          });
          await sendCdpCommand("Input.dispatchKeyEvent", {
            type: "keyUp",
            text: char,
          });
        }
        break;
      }
      case "scroll": {
        await sendCdpCommand("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: 400,
          y: 400,
          deltaX: 0,
          deltaY: parsed.value === "up" ? -300 : 300,
        });
        break;
      }
      case "navigate": {
        await sendCdpCommand("Page.navigate", {
          url: parsed.value,
        });
        break;
      }
    }

    return { success: true, ...parsed };
  } catch {
    return { response, note: "Could not parse action JSON" };
  }
}

async function executeObserve(
  instruction: string,
  screenshot: string,
  apiKey: string
): Promise<unknown> {
  const systemPrompt = `You are a browser automation assistant. The user wants to observe/identify elements on the current webpage.
Look at the screenshot and find elements matching the user's description.
Return a JSON array of observable actions/elements:
[
  {
    "description": "what the element is",
    "selector": "CSS selector",
    "type": "button | link | input | text | image | other",
    "text": "visible text content"
  }
]
Return ONLY the JSON array, no other text.`;

  const response = await callAnthropicAPI(instruction, screenshot, systemPrompt, apiKey);

  try {
    return JSON.parse(response);
  } catch {
    return [{ description: response }];
  }
}

async function executeExtract(
  instruction: string,
  screenshot: string,
  apiKey: string
): Promise<unknown> {
  const systemPrompt = `You are a browser automation assistant. The user wants to extract structured data from the current webpage.
Look at the screenshot and extract the requested information.
Return the extracted data as a JSON object matching what the user asked for.
Return ONLY the JSON, no other text.`;

  const response = await callAnthropicAPI(instruction, screenshot, systemPrompt, apiKey);

  try {
    return JSON.parse(response);
  } catch {
    return { text: response };
  }
}

async function executeAgent(
  instruction: string,
  screenshot: string,
  apiKey: string
): Promise<unknown> {
  const systemPrompt = `You are an AI browser agent that can perform multi-step tasks on webpages.
The user has given you an instruction to accomplish. Look at the current state of the webpage (screenshot provided).

Determine the next step to take. Return a JSON object:
{
  "thought": "your reasoning about what to do next",
  "action": "click" | "type" | "scroll" | "navigate" | "extract" | "done",
  "selector": "CSS selector (if applicable)",
  "value": "text to type / URL to navigate / data to extract",
  "description": "brief description of what you're doing"
}

If the task is complete, use action "done" and put the final result/answer in "value".
Return ONLY the JSON, no other text.`;

  const maxSteps = 10;
  const steps: unknown[] = [];
  let currentScreenshot = screenshot;

  for (let step = 0; step < maxSteps; step++) {
    const response = await callAnthropicAPI(
      step === 0
        ? instruction
        : `Original instruction: ${instruction}\n\nPrevious steps taken:\n${JSON.stringify(steps, null, 2)}\n\nWhat should we do next?`,
      currentScreenshot,
      systemPrompt,
      apiKey
    );

    let parsed;
    try {
      parsed = JSON.parse(response);
    } catch {
      steps.push({ step: step + 1, response });
      break;
    }

    steps.push({ step: step + 1, ...parsed });

    if (parsed.action === "done") {
      break;
    }

    // Execute the step using the act logic
    if (parsed.action === "click" && parsed.selector) {
      const nodeResult = await sendCdpCommand("Runtime.evaluate", {
        expression: `document.querySelector('${parsed.selector.replace(/'/g, "\\'")}')?.getBoundingClientRect()`,
        returnByValue: true,
      });
      const rect = (nodeResult as { result?: { value?: DOMRect } })?.result?.value;
      if (rect) {
        const x = rect.x + rect.width / 2;
        const y = rect.y + rect.height / 2;
        await sendCdpCommand("Input.dispatchMouseEvent", {
          type: "mousePressed", x, y, button: "left", clickCount: 1,
        });
        await sendCdpCommand("Input.dispatchMouseEvent", {
          type: "mouseReleased", x, y, button: "left", clickCount: 1,
        });
      }
    } else if (parsed.action === "type" && parsed.selector) {
      await sendCdpCommand("Runtime.evaluate", {
        expression: `document.querySelector('${parsed.selector.replace(/'/g, "\\'")}')?.focus()`,
      });
      for (const char of parsed.value || "") {
        await sendCdpCommand("Input.dispatchKeyEvent", { type: "keyDown", text: char });
        await sendCdpCommand("Input.dispatchKeyEvent", { type: "keyUp", text: char });
      }
    } else if (parsed.action === "scroll") {
      await sendCdpCommand("Input.dispatchMouseEvent", {
        type: "mouseWheel", x: 400, y: 400, deltaX: 0,
        deltaY: parsed.value === "up" ? -300 : 300,
      });
    } else if (parsed.action === "navigate") {
      await sendCdpCommand("Page.navigate", { url: parsed.value });
    }

    // Wait for page to settle, then take a new screenshot
    await new Promise((r) => setTimeout(r, 1500));

    const newScreenshot = await sendCdpCommand("Page.captureScreenshot", { format: "png" });
    currentScreenshot = (newScreenshot as { data: string }).data;
  }

  return {
    success: true,
    steps,
    totalSteps: steps.length,
  };
}

// ──────────────────────────────────────────────────────────
// Initial render
// ──────────────────────────────────────────────────────────

updateUI();
