const SERVER = "http://localhost:7878";
const SCREENSHOT_THROTTLE_MS = 500; // debouncing; otherwise one field input (multi input event) can trigger many screenshots

let lastScreenshot = 0;

// Auto-focus newly created tabs so the agent's working tab is always visible
chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.update(tab.id, { active: true });
  }
});

// Receive events from content script
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "action") {
    // Bring the tab where the action occurred to front so the screen recording
    // and captureVisibleTab always show the tab the agent is working on.
    if (sender.tab && sender.tab.id) {
      chrome.tabs.update(sender.tab.id, { active: true });
    }
    postAction(msg.data);
    captureScreenshot();
  }
});

async function postAction(data) {
  try {
    await fetch(`${SERVER}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch (e) {
    console.error("[clawbench] postAction failed:", e);
  }
}

async function captureScreenshot() {
  const now = Date.now();
  if (now - lastScreenshot < SCREENSHOT_THROTTLE_MS) return;
  lastScreenshot = now;

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: "png",
    });
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    await fetch(`${SERVER}/api/screenshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timestamp: now, data: base64 }),
    });
  } catch (e) {
    console.error("[clawbench] captureScreenshot failed:", e);
  }
}
