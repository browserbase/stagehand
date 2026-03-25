/**
 * Resolve a --ws value to a CDP WebSocket URL.
 * Accepts a bare port number (e.g. "9222"), which is resolved via the
 * /json/version endpoint, or a full URL (ws://, wss://, http://) used as-is.
 */
export async function resolveWsTarget(input: string): Promise<string> {
  // Bare numeric port → discover via /json/version
  if (/^\d+$/.test(input)) {
    const port = input;
    const url = `http://127.0.0.1:${port}/json/version`;
    try {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} from ${url}`);
      }
      const json = (await res.json()) as { webSocketDebuggerUrl?: string };
      if (json.webSocketDebuggerUrl) {
        return json.webSocketDebuggerUrl;
      }
    } catch {
      // /json/version unavailable — fall back to a conventional WS URL
    }
    return `ws://127.0.0.1:${port}/devtools/browser`;
  }
  // Already a URL — use as-is
  return input;
}
