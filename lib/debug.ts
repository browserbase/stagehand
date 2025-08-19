/**
 * Debug utility for Stagehand that intercepts Playwright's CDP protocol logs
 * and marks calls that originated from Stagehand code
 */

const DEBUG = process.env.DEBUG || "";
const debugNamespaces = DEBUG.split(",").map((ns) => ns.trim());

// If sh:protocol is enabled, automatically enable pw:protocol
// This must happen before any Playwright imports
if (
  debugNamespaces.includes("sh:protocol") &&
  !debugNamespaces.some((ns) => ns.includes("pw:protocol"))
) {
  debugNamespaces.push("pw:protocol");
  // Update process.env.DEBUG to include pw:protocol
  process.env.DEBUG = debugNamespaces.join(",");
}

// Track pending Stagehand CDP calls by method name and timestamp
interface PendingCall {
  method: string;
  timestamp: number;
  sessionId?: string;
}

const pendingStagehandCalls: PendingCall[] = [];
const CALL_TIMEOUT_MS = 100; // Clear old pending calls after 100ms

// Clean up old pending calls
function cleanupOldCalls() {
  const now = Date.now();
  const index = pendingStagehandCalls.findIndex(
    (call) => now - call.timestamp > CALL_TIMEOUT_MS,
  );
  if (index > 0) {
    pendingStagehandCalls.splice(0, index);
  }
}

// Intercept stderr to rewrite Playwright protocol logs for Stagehand-originated calls
if (
  debugNamespaces.includes("sh:protocol") &&
  debugNamespaces.some((ns) => ns.includes("pw:protocol"))
) {
  const originalStderrWrite = process.stderr.write;

  // Track message IDs that we've identified as Stagehand calls
  const stagehandMessageIds = new Set<number>();

  process.stderr.write = function (
    chunk: unknown,
    ...args: unknown[]
  ): boolean {
    const str = chunk?.toString();

    if (str && str.includes("pw:protocol")) {
      // Check if this is a SEND
      const sendMatch = str.match(/pw:protocol SEND ► ({.*})/);
      if (sendMatch) {
        try {
          const message = JSON.parse(sendMatch[1]);

          // Check if this matches a pending Stagehand call
          cleanupOldCalls();
          const pendingIndex = pendingStagehandCalls.findIndex(
            (call) =>
              call.method === message.method &&
              (!call.sessionId || call.sessionId === message.sessionId),
          );

          if (pendingIndex >= 0) {
            // This is a Stagehand call - mark it and rewrite the log
            stagehandMessageIds.add(message.id);
            pendingStagehandCalls.splice(pendingIndex, 1);
            chunk = str.replace("pw:protocol", "sh:protocol");
          }
        } catch {
          // Ignore JSON parse errors
        }
      }

      // Check if this is a RECV for a Stagehand request
      const recvMatch = str.match(/pw:protocol ◀ RECV ({.*})/);
      if (recvMatch) {
        try {
          const message = JSON.parse(recvMatch[1]);
          if (message.id && stagehandMessageIds.has(message.id)) {
            // This is a response to a Stagehand call
            chunk = str.replace("pw:protocol", "sh:protocol");
            stagehandMessageIds.delete(message.id);
          }
        } catch {
          // Ignore JSON parse errors
        }
      }
    }

    return originalStderrWrite.apply(process.stderr, [chunk, ...args]);
  };
}

// Mark that a CDP call is about to be made from Stagehand
export function markStagehandCDPCall(method: string, sessionId?: string) {
  if (debugNamespaces.includes("sh:protocol")) {
    pendingStagehandCalls.push({
      method,
      timestamp: Date.now(),
      sessionId,
    });
  }
}

// Simple logger for non-CDP messages
export function createDebugLogger(namespace: string) {
  const enabled = debugNamespaces.some((ns) => {
    if (ns.endsWith("*")) {
      return namespace.startsWith(ns.slice(0, -1));
    }
    return ns === namespace;
  });

  return {
    enabled,
    log: (...args: unknown[]) => {
      if (!enabled) return;

      const timestamp = new Date().toISOString();
      const prefix = `${timestamp} ${namespace} `;

      const message = args
        .map((arg) => {
          if (typeof arg === "object") {
            try {
              return JSON.stringify(arg, null, 2);
            } catch {
              // Fallback to String for circular objects
              return String(arg);
            }
          }
          return String(arg);
        })
        .join(" ");

      process.stderr.write(`${prefix}${message}\n`);
    },
  };
}

export const shProtocolDebug = createDebugLogger("sh:protocol");
