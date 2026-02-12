/**
 * Shutdown supervisor process.
 *
 * This process watches a lifeline (stdin/IPC). When the parent dies, the
 * lifeline closes and the supervisor performs best-effort cleanup:
 * - LOCAL: kill Chrome + remove temp profile (when keepAlive is false)
 * - STAGEHAND_API: request session release (when keepAlive is false)
 */

import fs from "node:fs";
import Browserbase from "@browserbasehq/sdk";
import type {
  ShutdownSupervisorConfig,
  ShutdownSupervisorMessage,
} from "../types/private/shutdown";

const SIGNAL_POLL_MS = 800;
const PID_POLL_INTERVAL_MS = 500;

let armed = false;
let config: ShutdownSupervisorConfig | null = null;
let cleanupPromise: Promise<void> | null = null;

const exit = (code = 0): void => {
  try {
    process.exit(code);
  } catch {
    // ignore
  }
};

const safeKill = async (pid: number): Promise<void> => {
  const isAlive = (): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };

  if (!isAlive()) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, SIGNAL_POLL_MS));
  if (!isAlive()) return;
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // best-effort
  }
};

let pidGone = false;
let pidPollTimer: NodeJS.Timeout | null = null;

const startPidPolling = (pid: number): void => {
  if (pidPollTimer) return;
  pidPollTimer = setInterval(() => {
    try {
      process.kill(pid, 0);
    } catch {
      pidGone = true;
      if (pidPollTimer) {
        clearInterval(pidPollTimer);
        pidPollTimer = null;
      }
    }
  }, PID_POLL_INTERVAL_MS);
};

const cleanupLocal = async (
  cfg: Extract<ShutdownSupervisorConfig, { kind: "LOCAL" }>,
) => {
  if (cfg.keepAlive) return;
  if (cfg.pid) {
    if (!pidGone) {
      await safeKill(cfg.pid);
    }
  }
  if (cfg.createdTempProfile && !cfg.preserveUserDataDir && cfg.userDataDir) {
    try {
      fs.rmSync(cfg.userDataDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
};

const cleanupBrowserbase = async (
  cfg: Extract<ShutdownSupervisorConfig, { kind: "STAGEHAND_API" }>,
) => {
  if (cfg.keepAlive) return;
  if (!cfg.apiKey || !cfg.projectId || !cfg.sessionId) return;
  try {
    const bb = new Browserbase({ apiKey: cfg.apiKey });
    await bb.sessions.update(cfg.sessionId, {
      status: "REQUEST_RELEASE",
      projectId: cfg.projectId,
    });
  } catch {
    // best-effort cleanup
  }
};

const runCleanup = (): Promise<void> => {
  if (!cleanupPromise) {
    cleanupPromise = (async () => {
      const cfg = config;
      if (!cfg || !armed) return;
      armed = false;
      if (cfg.kind === "LOCAL") {
        await cleanupLocal(cfg);
        return;
      }
      if (cfg.kind === "STAGEHAND_API") {
        await cleanupBrowserbase(cfg);
      }
    })();
  }
  return cleanupPromise;
};

const onLifelineClosed = () => {
  void runCleanup().finally(() => exit(0));
};

const onMessage = (raw: unknown) => {
  if (!raw || typeof raw !== "object") return;
  const msg = raw as ShutdownSupervisorMessage;
  if (msg.type === "config") {
    config = msg.config ?? null;
    armed = Boolean(config) && config?.keepAlive === false;
    if (armed && config?.kind === "LOCAL" && config?.pid) {
      startPidPolling(config.pid);
    }
    try {
      process.send?.({ type: "ready" });
    } catch {
      // ignore IPC failures
    }
    return;
  }
  if (msg.type === "exit") {
    armed = false;
    exit(0);
  }
};

// Keep stdin open as a lifeline to the parent process.
try {
  process.stdin.resume();
  process.stdin.on("end", onLifelineClosed);
  process.stdin.on("close", onLifelineClosed);
  process.stdin.on("error", onLifelineClosed);
} catch {
  // ignore
}

process.on("disconnect", onLifelineClosed);
process.on("message", onMessage);
