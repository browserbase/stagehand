/**
 * Debug utility for Stagehand that follows Playwright's debug pattern
 * Logs to stderr when DEBUG environment variable contains the namespace
 */

const DEBUG = process.env.DEBUG || "";
const debugNamespaces = DEBUG.split(",").map((ns) => ns.trim());

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

      // Format the message similar to Playwright's debug output
      const message = args
        .map((arg) => {
          if (typeof arg === "object") {
            try {
              return JSON.stringify(arg, null, 2);
            } catch {
              return String(arg);
            }
          }
          return String(arg);
        })
        .join(" ");

      // Write to stderr with timestamp and namespace prefix
      process.stderr.write(`${prefix}${message}\n`);
    },
  };
}

// Pre-configured logger for CDP protocol messages
export const shProtocolDebug = createDebugLogger("sh:protocol");

// Helper to wrap CDP session.send calls with logging
export async function sendCDPWithLogging<T = unknown>(
  session: { send: (method: string, params?: unknown) => Promise<unknown> },
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const requestId = Math.floor(Math.random() * 10000) + 4000;
  let sessionId: string | undefined;
  try {
    // @ts-expect-error - accessing private property
    sessionId = session._sessionId || session.id;
  } catch {
    sessionId = undefined;
  }

  const sendLog: Record<string, unknown> = { id: requestId, method };
  if (Object.keys(params).length > 0) {
    sendLog.params = params;
  }
  if (sessionId) {
    sendLog.sessionId = sessionId;
  }
  shProtocolDebug.log(`SEND ► ${JSON.stringify(sendLog)}`);

  const result = (await session.send(method, params)) as T;

  const recvLog: Record<string, unknown> = { id: requestId };
  if (result !== undefined) {
    recvLog.result = result;
  }
  if (sessionId) {
    recvLog.sessionId = sessionId;
  }
  shProtocolDebug.log(`◀ RECV ${JSON.stringify(recvLog)}`);

  return result;
}
