/**
 * Shutdown supervisor process.
 *
 * This process watches a lifeline (stdin/IPC). When the parent dies, the
 * lifeline closes and the supervisor performs best-effort cleanup:
 * - LOCAL: kill Chrome + remove temp profile (when keepAlive is false)
 * - STAGEHAND_API: request session release (when keepAlive is false)
 */

import Browserbase from "@browserbasehq/sdk";
import type {
  ShutdownSupervisorConfig,
  ShutdownSupervisorMessage,
} from "../types/private/shutdown.js";
import { cleanupLocalBrowser } from "./cleanupLocal.js";

const SIGKILL_POLL_MS = 500;
const SIGKILL_TIMEOUT_MS = 10_000;
const PID_POLL_INTERVAL_MS = 500;

let armed = false;
let config: ShutdownSupervisorConfig | null = null;
let cleanupPromise: Promise<void> | null = null;
let started = false;

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

let pidGone = false;
let pidPollTimer: NodeJS.Timeout | null = null;

const parseBoolean = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return undefined;
};

const parseNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
};

const getArgValue = (
  argv: readonly string[],
  name: string,
): string | undefined => {
  const prefix = `--${name}=`;
  for (const arg of argv) {
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === `--${name}`) return "true";
  }
  return undefined;
};

const hasArg = (argv: readonly string[], name: string): boolean =>
  argv.some((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));

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
  await cleanupLocalBrowser({
    killChrome: cfg.pid && !pidGone ? () => safeKill(cfg.pid) : undefined,
    userDataDir: cfg.userDataDir,
    createdTempProfile: cfg.createdTempProfile,
    preserveUserDataDir: cfg.preserveUserDataDir,
  });
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

const applyConfig = (nextConfig: ShutdownSupervisorConfig | null): void => {
  config = nextConfig;
  armed = Boolean(config) && config.keepAlive === false;
  if (armed && config?.kind === "LOCAL" && config.pid) {
    startPidPolling(config.pid);
  }
};

const notifyReady = (): void => {
  try {
    const message: ShutdownSupervisorMessage = { type: "ready" };
    process.send?.(message);
  } catch {
    // ignore IPC failures
  }
};

const onLifelineClosed = () => {
  void runCleanup().finally(() => exit(0));
};

const onMessage = (raw: unknown) => {
  if (!raw || typeof raw !== "object") return;
  const msg = raw as ShutdownSupervisorMessage;
  if (msg.type === "exit") {
    armed = false;
    exit(0);
  }
};

export const parseShutdownSupervisorConfigFromArgv = (
  argv: readonly string[] = process.argv.slice(2),
): ShutdownSupervisorConfig | null => {
  if (!hasArg(argv, "supervisor")) return null;
  const kind = getArgValue(argv, "kind");
  const keepAlive = parseBoolean(getArgValue(argv, "keep-alive")) ?? false;

  if (kind === "LOCAL") {
    const pid = parseNumber(getArgValue(argv, "chrome-pid"));
    if (!pid) return null;
    const userDataDir = getArgValue(argv, "user-data-dir");
    const createdTempProfile = parseBoolean(
      getArgValue(argv, "created-temp-profile"),
    );
    const preserveUserDataDir = parseBoolean(
      getArgValue(argv, "preserve-user-data-dir"),
    );
    return {
      kind: "LOCAL",
      keepAlive,
      pid,
      ...(userDataDir ? { userDataDir } : {}),
      ...(createdTempProfile !== undefined ? { createdTempProfile } : {}),
      ...(preserveUserDataDir !== undefined ? { preserveUserDataDir } : {}),
    };
  }

  if (kind === "STAGEHAND_API") {
    const sessionId = getArgValue(argv, "session-id");
    const apiKey = getArgValue(argv, "api-key");
    const projectId = getArgValue(argv, "project-id");
    if (!sessionId || !apiKey || !projectId) return null;
    return {
      kind: "STAGEHAND_API",
      keepAlive,
      sessionId,
      apiKey,
      projectId,
    };
  }

  return null;
};

export const runShutdownSupervisor = (
  initialConfig: ShutdownSupervisorConfig | null = null,
): void => {
  if (started) return;
  started = true;
  applyConfig(initialConfig);

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

  if (initialConfig) {
    notifyReady();
  }
};

export const maybeRunShutdownSupervisorFromArgv = (
  argv: readonly string[] = process.argv.slice(2),
): boolean => {
  const parsed = parseShutdownSupervisorConfigFromArgv(argv);
  if (!parsed) return false;
  runShutdownSupervisor(parsed);
  return true;
};
