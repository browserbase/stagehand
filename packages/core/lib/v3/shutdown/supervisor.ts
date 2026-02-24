/**
 * Shutdown supervisor process.
 *
 * This process watches a stdin lifeline. When the parent dies, stdin closes
 * and the supervisor performs best-effort cleanup:
 * - LOCAL: kill Chrome + remove temp profile
 * - STAGEHAND_API: request session release
 */

import Browserbase from "@browserbasehq/sdk";
import type { ShutdownSupervisorConfig } from "../types/private/shutdown.js";
import { cleanupLocalBrowser } from "./cleanupLocal.js";

const SIGKILL_POLL_MS = 250;
const SIGKILL_TIMEOUT_MS = 7_000;
const PID_POLL_INTERVAL_MS = 500;

// `cleanupPromise` guarantees we execute cleanup at most once.
let config: ShutdownSupervisorConfig | null = null;
let cleanupPromise: Promise<void> | null = null;
let started = false;
let localPidKnownGone = false;

const exit = (code = 0): void => {
  try {
    process.exit(code);
  } catch {
    // ignore
  }
};

// Best-effort two-phase kill: SIGTERM first, then SIGKILL after timeout.
// Treat only ESRCH as "already gone"; other errors should not imply dead.
const politeKill = async (pid: number): Promise<void> => {
  const isAlive = (): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      // ESRCH = "No such process" (PID is already gone).
      return err.code !== "ESRCH";
    }
  };

  if (!isAlive()) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    // ESRCH = process already exited; no further action needed.
    if (err.code === "ESRCH") return;
  }

  const deadline = Date.now() + SIGKILL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SIGKILL_POLL_MS));
    if (!isAlive()) return;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // best-effort
  }
};

let pidPollTimer: NodeJS.Timeout | null = null;

// Local-only fallback: if Chrome dies while parent still lives, run cleanup and exit.
const startPidPolling = (pid: number): void => {
  if (pidPollTimer) return;
  pidPollTimer = setInterval(() => {
    try {
      process.kill(pid, 0);
      return;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      // Only ESRCH means the process is definitely gone.
      if (err.code !== "ESRCH") return;
    }

    localPidKnownGone = true;
    if (pidPollTimer) {
      clearInterval(pidPollTimer);
      pidPollTimer = null;
    }
    void runCleanup("Browser process exited").finally(() => exit(0));
  }, PID_POLL_INTERVAL_MS);
};

const cleanupLocal = async (
  cfg: Extract<ShutdownSupervisorConfig, { kind: "LOCAL" }>,
  reason: string,
) => {
  const deletingUserDataDir = Boolean(
    cfg.createdTempProfile && !cfg.preserveUserDataDir && cfg.userDataDir,
  );
  await cleanupLocalBrowser({
    // If polling already observed ESRCH, avoid a follow-up PID kill.
    // The PID could be reused by a different process before cleanup runs.
    killChrome:
      cfg.pid && !localPidKnownGone
        ? () => {
            console.error(
              `[shutdown-supervisor] Shutting down Chrome pid=${cfg.pid} ` +
                `(reason=${reason}, deletingUserDataDir=${deletingUserDataDir})`,
            );
            return politeKill(cfg.pid);
          }
        : undefined,
    userDataDir: cfg.userDataDir,
    createdTempProfile: cfg.createdTempProfile,
    preserveUserDataDir: cfg.preserveUserDataDir,
  });
};

const cleanupBrowserbase = async (
  cfg: Extract<ShutdownSupervisorConfig, { kind: "STAGEHAND_API" }>,
  reason: string,
) => {
  if (!cfg.apiKey || !cfg.projectId || !cfg.sessionId) return;
  try {
    console.error(
      `[shutdown-supervisor] Ending Browserbase session ${cfg.sessionId} ` +
        `(reason=${reason})`,
    );
    const bb = new Browserbase({ apiKey: cfg.apiKey });
    await bb.sessions.update(cfg.sessionId, {
      status: "REQUEST_RELEASE",
      projectId: cfg.projectId,
    });
  } catch {
    // best-effort cleanup
  }
};

// Idempotent cleanup entrypoint used by all supervisor shutdown paths.
const runCleanup = (reason: string): Promise<void> => {
  if (!cleanupPromise) {
    cleanupPromise = (async () => {
      const cfg = config;
      if (!cfg) return;
      if (cfg.kind === "LOCAL") {
        await cleanupLocal(cfg, reason);
        return;
      }
      if (cfg.kind === "STAGEHAND_API") {
        await cleanupBrowserbase(cfg, reason);
      }
    })();
  }
  return cleanupPromise;
};

const applyConfig = (nextConfig: ShutdownSupervisorConfig): void => {
  config = nextConfig;
  localPidKnownGone = false;
  if (config.kind === "LOCAL" && config.pid) {
    startPidPolling(config.pid);
  }
};

const onLifelineClosed = (reason: string) => {
  void runCleanup(reason).finally(() => exit(0));
};

const parseConfigFromArgv = (
  argv: readonly string[] = process.argv.slice(2),
): ShutdownSupervisorConfig | null => {
  const prefix = "--supervisor-config=";
  const raw = argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
  if (!argv.includes("--supervisor") || !raw) return null;
  try {
    return JSON.parse(raw) as ShutdownSupervisorConfig;
  } catch {
    return null;
  }
};

export const runShutdownSupervisor = (
  initialConfig: ShutdownSupervisorConfig,
): void => {
  if (started) return;
  started = true;
  applyConfig(initialConfig);

  // Stdin is the lifeline; losing it means parent is gone.
  try {
    process.stdin.resume();
    process.stdin.on("end", () =>
      onLifelineClosed("Stagehand process completed"),
    );
    process.stdin.on("close", () =>
      onLifelineClosed("Stagehand process completed"),
    );
    process.stdin.on("error", () =>
      onLifelineClosed("Stagehand process crashed or was killed"),
    );
  } catch {
    // ignore
  }
};

export const maybeRunShutdownSupervisorFromArgv = (
  argv: readonly string[] = process.argv.slice(2),
): boolean => {
  const parsed = parseConfigFromArgv(argv);
  if (!parsed) return false;
  runShutdownSupervisor(parsed);
  return true;
};
