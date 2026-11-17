import {
  ensureDriverDaemon,
  openViaDaemon,
  runDriverCommandViaDaemon,
  stopDriverDaemon,
} from "./daemon/client.js";
import { CommandFailure } from "../errors.js";
import type { DriverCommandName } from "./commands/types.js";
import type { ConnectionTarget } from "./types.js";

export type DriverSessionSelection =
  | { kind: "existing"; fallbackTarget?: ConnectionTarget }
  | { kind: "create"; target: ConnectionTarget };

type OpenCommandParams = {
  timeoutMs?: number;
  url: string;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
};

export async function runDriverCommand(
  session: string,
  selection: DriverSessionSelection,
  command: DriverCommandName,
  params?: unknown,
): Promise<unknown> {
  if (selection.kind === "create") {
    await ensureDriverDaemon({ session, target: selection.target });
  }
  if (command === "open" && isOpenCommandParams(params)) {
    return openViaDaemonWithRecovery(session, selection, params);
  }

  return runDriverCommandViaDaemon(session, command, params);
}

async function openViaDaemonWithRecovery(
  session: string,
  selection: DriverSessionSelection,
  params: OpenCommandParams,
): Promise<unknown> {
  try {
    return await openViaDaemon(session, params.url, params);
  } catch (error) {
    // Auto-recover when reusing a session whose daemon or browser is broken.
    // The recovery uses the caller's flags (never daemon-reported settings),
    // preserving the security intent of the original session-reuse separation.
    if (selection.kind === "existing" && selection.fallbackTarget && shouldRecoverDaemon(error)) {
      // For driver_error (browser/page failures), force-stop the daemon first
      // since it's still running but has a stale browser. For socket errors,
      // the daemon is already gone so this is a no-op.
      if (error instanceof CommandFailure && error.telemetry.resultCode === "driver_error") {
        await stopDriverDaemon(session, true);
      }
      await ensureDriverDaemon({ session, target: selection.fallbackTarget });
      return openViaDaemon(session, params.url, params);
    }
    throw error;
  }
}

function shouldRecoverDaemon(error: unknown): boolean {
  if (!(error instanceof CommandFailure)) return false;
  const code = error.telemetry.resultCode;
  // Recover when the daemon is gone, crashed, or has a stale browser:
  // - daemon_not_running: socket connection failed (ECONNREFUSED/ENOENT)
  // - daemon_connection_lost: daemon closed mid-request
  // - daemon_socket_error_*: socket write/read failed (e.g., EPIPE when daemon crashed)
  // - driver_error: browser/page operation failed (e.g., page.goto on stale browser)
  // Do NOT recover on daemon_socket_timeout since the old process may still be alive.
  return (
    code === "daemon_not_running" ||
    code === "daemon_connection_lost" ||
    code === "driver_error" ||
    (typeof code === "string" && code.startsWith("daemon_socket_error_"))
  );
}

function isOpenCommandParams(params: unknown): params is OpenCommandParams {
  return (
    typeof params === "object" &&
    params !== null &&
    typeof (params as { url?: unknown }).url === "string"
  );
}
