const STAGEHAND_SERVICE_WORKER_HEARTBEAT_PORT = "StagehandExtensionServiceWorkerHeartbeat";
const STAGEHAND_SERVICE_WORKER_HEARTBEAT_INTERVAL_MS = 1_000;

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
