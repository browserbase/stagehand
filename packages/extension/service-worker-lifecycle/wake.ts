/// <reference types="chrome" />

chrome.runtime.sendMessage(
  { type: "stagehand_wake_service_worker" },
  () => void chrome.runtime.lastError,
);
