import {
  ensureDriverDaemon,
  openViaDaemon,
  runDriverCommandViaDaemon,
} from "./daemon/client.js";
import type { DriverCommandName } from "./commands/types.js";
import type { ConnectionTarget } from "./types.js";

type OpenCommandParams = {
  timeoutMs?: number;
  url: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
};

export async function runDriverCommandWithTarget(
  session: string,
  target: ConnectionTarget,
  command: DriverCommandName,
  params?: unknown,
): Promise<unknown> {
  await ensureDriverDaemon({ session, target });
  if (command === "open" && isOpenCommandParams(params)) {
    return openViaDaemon(session, params.url, params);
  }

  return runDriverCommandViaDaemon(session, command, params);
}

function isOpenCommandParams(params: unknown): params is OpenCommandParams {
  return (
    typeof params === "object" &&
    params !== null &&
    typeof (params as { url?: unknown }).url === "string"
  );
}
