/**
 * Parent-side helper for spawning the shutdown supervisor process.
 *
 * The supervisor runs out-of-process and watches a lifeline pipe. If the parent
 * dies, the supervisor performs best-effort cleanup (Chrome kill or Browserbase
 * session release) when keepAlive is false.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type {
  ShutdownSupervisorConfig,
  ShutdownSupervisorHandle,
  ShutdownSupervisorMessage,
} from "../types/private/shutdown";
import {
  ShutdownSupervisorResolveError,
  ShutdownSupervisorSpawnError,
} from "../types/private/shutdownErrors";

const READY_TIMEOUT_MS = 500;
const thisDir = path.dirname(fileURLToPath(import.meta.url));

const resolveSupervisorScript = (): {
  command: string;
  args: string[];
} | null => {
  const jsPath = path.resolve(thisDir, "supervisor.js");
  if (fs.existsSync(jsPath)) {
    return { command: process.execPath, args: [jsPath] };
  }
  const tsPath = path.resolve(thisDir, "supervisor.ts");
  if (fs.existsSync(tsPath)) {
    return { command: process.execPath, args: ["--import", "tsx", tsPath] };
  }
  return null;
};

/**
 * Start a supervisor process for crash cleanup. Returns a handle that can
 * stop the supervisor during a normal shutdown.
 */
export function startShutdownSupervisor(
  config: ShutdownSupervisorConfig,
  opts?: { onError?: (error: Error, context: string) => void },
): ShutdownSupervisorHandle | null {
  const resolved = resolveSupervisorScript();
  if (!resolved) {
    opts?.onError?.(
      new ShutdownSupervisorResolveError(
        "Shutdown supervisor script missing (expected supervisor.js or supervisor.ts next to shutdown/supervisorClient).",
      ),
      "resolve",
    );
    return null;
  }

  const child = spawn(resolved.command, resolved.args, {
    stdio: ["pipe", "ignore", "ignore", "ipc"],
    detached: true,
  });
  child.on("error", (error) => {
    opts?.onError?.(
      new ShutdownSupervisorSpawnError(
        `Shutdown supervisor failed to start: ${error.message}`,
      ),
      "spawn",
    );
  });

  try {
    child.unref();
    const stdin = child.stdin as unknown as { unref?: () => void } | null;
    stdin?.unref?.();
  } catch {
    // best-effort: avoid keeping the event loop alive
  }

  try {
    const message: ShutdownSupervisorMessage = { type: "config", config };
    child.send?.(message);
  } catch {
    // ignore IPC failures
  }

  const ready = new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      child.off("message", onMessage);
      resolve();
    };
    const timer = setTimeout(done, READY_TIMEOUT_MS);
    const onMessage = (msg: unknown) => {
      const payload = msg as ShutdownSupervisorMessage;
      if (payload?.type === "ready") {
        done();
      }
    };
    child.on("message", onMessage);
    child.on("exit", done);
  });

  const stop = () => {
    try {
      const message: ShutdownSupervisorMessage = { type: "exit" };
      child.send?.(message);
    } catch {
      // ignore
    }
    try {
      child.disconnect?.();
    } catch {
      // ignore
    }
  };

  return { stop, ready };
}
