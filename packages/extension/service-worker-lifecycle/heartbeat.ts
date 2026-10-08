const STAGEHAND_SERVICE_WORKER_HEARTBEAT_PORT = "StagehandExtensionServiceWorkerHeartbeat";
// Chrome 114+ no longer resets the 30s idle timer when a port is opened.
// Posting a message does, so this interval must stay under that timeout.
const STAGEHAND_SERVICE_WORKER_HEARTBEAT_INTERVAL_MS = 20_000;

let port: chrome.runtime.Port | null = null;

function sendServiceWorkerHeartbeat(): void {
  port?.postMessage({
    type: "StagehandExtensionServiceWorkerHeartbeat",
    at: new Date().toISOString(),
  });
}

function connectServiceWorkerHeartbeatPort(): void {
  port = chrome.runtime.connect({ name: STAGEHAND_SERVICE_WORKER_HEARTBEAT_PORT });
  port.onDisconnect.addListener(() => {
    port = null;
    setTimeout(connectServiceWorkerHeartbeatPort, 250);
  });
  sendServiceWorkerHeartbeat();
}

connectServiceWorkerHeartbeatPort();
setInterval(sendServiceWorkerHeartbeat, STAGEHAND_SERVICE_WORKER_HEARTBEAT_INTERVAL_MS);
