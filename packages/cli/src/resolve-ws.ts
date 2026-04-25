/**
 * Resolve a --ws value to a CDP WebSocket URL.
 * Accepts a bare port number (e.g. "9222"), which prefers an exact
 * DevToolsActivePort match and otherwise falls back to /json/version,
 * or a full URL (ws://, wss://, http://) used as-is.
 */
import { resolveWsTargetFromPort } from "./local-cdp-discovery";

interface ResolveWsTargetOptions {
  userDataDirs?: string[];
}

export async function resolveWsTarget(
  input: string,
  options: ResolveWsTargetOptions = {},
): Promise<string> {
  // Bare numeric port → discover from DevToolsActivePort or /json/version
  if (/^\d+$/.test(input)) {
    return resolveWsTargetFromPort(parseInt(input, 10), options);
  }
  // Already a URL — use as-is
  return input;
}
