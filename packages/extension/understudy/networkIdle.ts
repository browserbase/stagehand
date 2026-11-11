import type { Protocol } from "devtools-protocol";
import {
  DEFAULT_IDLE_WAIT,
  IGNORED_RESOURCE_TYPES,
  type NetworkRequestInfo,
} from "../types/private/network.js";
import type { Page } from "./page.js";
import type { Progress } from "./progress.js";

/** Wait for the current main document to load, then establish a fresh quiet window. */
export async function waitForMainNetworkIdle(
  page: Page,
  progress: Progress,
  callerSignal?: AbortSignal,
): Promise<void> {
  const documentChanged = new Error("Main document changed during network-idle wait");
  let documentWait = new AbortController();
  const connectionClosed = new AbortController();
  const onConnectionClosed = (reason: string) => {
    connectionClosed.abort(new Error(`CDP connection closed: ${reason}`));
  };
  const onFrameNavigated = (event: Protocol.Page.FrameNavigatedEvent) => {
    if (event.frame.parentId) return;
    documentWait.abort(documentChanged);
  };
  const onFrameDetached = (event: Protocol.Page.FrameDetachedEvent) => {
    if (event.frameId === page.mainFrameId() && event.reason !== "swap") {
      connectionClosed.abort(new Error("Main frame was detached"));
    }
  };

  page.mainSession.on("Page.frameNavigated", onFrameNavigated);
  page.mainSession.on("Page.frameDetached", onFrameDetached);
  page.conn.onTransportClosed(onConnectionClosed);
  try {
    if (!page.conn.connected) onConnectionClosed("network-idle wait stopped");
    for (;;) {
      progress.throwIfStopped();
      documentWait = new AbortController();
      const signal = AbortSignal.any([
        progress.signal,
        page.closedSignal,
        connectionClosed.signal,
        documentWait.signal,
        ...(callerSignal ? [callerSignal] : []),
      ]);
      signal.throwIfAborted();
      const frameId = page.mainFrameId();
      const loaderId = page.registry.frames.get(frameId)?.lastSeen?.loaderId;
      try {
        await page.waitForMainLoadState("load", Math.ceil(progress.remainingMs()), signal);
        signal.throwIfAborted();
        await page.networkManager.waitForIdle({
          // Document identity scopes this wait; include requests that predate the call.
          startTime: 0,
          timeout: Infinity,
          idleTimeMs: DEFAULT_IDLE_WAIT,
          filter: mainDocumentIdleFilter(loaderId, frameId),
          signal,
        }).promise;
        signal.throwIfAborted();
        progress.throwIfStopped();
        return;
      } catch (error) {
        if (error !== documentChanged) throw error;
        // A replacement document needs its own load and quiet period, within the same budget.
      }
    }
  } finally {
    documentWait.abort(new Error("Network-idle wait disposed"));
    page.mainSession.off("Page.frameNavigated", onFrameNavigated);
    page.mainSession.off("Page.frameDetached", onFrameDetached);
    page.conn.offTransportClosed(onConnectionClosed);
  }
}

/** Select current main-document requests, excluding long-lived connections. */
export function mainDocumentIdleFilter(
  loaderId: string | undefined,
  mainFrameId: string,
): (info: NetworkRequestInfo) => boolean {
  return (info) => {
    if (IGNORED_RESOURCE_TYPES.has(info.resourceType)) return false;
    if (loaderId) return info.loaderId === loaderId;
    if (!info.loaderId && info.frameId) return info.frameId === mainFrameId;
    return true;
  };
}
