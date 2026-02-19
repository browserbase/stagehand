/**
 * Shutdown supervisor process.
 *
 * This process watches a lifeline (stdin/IPC). When the parent dies, the
 * lifeline closes and the supervisor performs best-effort cleanup:
 * - LOCAL: kill Chrome + remove temp profile (when keepAlive is false)
 * - STAGEHAND_API: request session release (when keepAlive is false)
 */

import { execFileSync } from "node:child_process";
import Browserbase from "@browserbasehq/sdk";
import type {
  ShutdownSupervisorConfig,
  ShutdownSupervisorMessage,
} from "../types/private/shutdown.js";
import { cleanupLocalBrowser } from "./cleanupLocal.js";

const SIGKILL_POLL_MS = 250;
const SIGKILL_TIMEOUT_MS = 7_000;
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
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      return err.code !== "ESRCH";
    }
  };

  if (!isAlive()) return;
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
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

const findPidsByUserDataDir = (userDataDir: string): number[] => {
  if (!userDataDir || process.platform === "win32") return [];
  try {
    const output = execFileSync("ps", ["-axo", "pid=,args="], {
      encoding: "utf8",
    });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const firstSpace = line.indexOf(" ");
        if (firstSpace === -1) return { pid: Number(line), args: "" };
        return {
          pid: Number(line.slice(0, firstSpace)),
          args: line.slice(firstSpace + 1),
        };
      })
      .filter(
        (entry) =>
          Number.isFinite(entry.pid) &&
          entry.pid > 0 &&
          entry.args.includes(`--user-data-dir=${userDataDir}`),
      )
      .map((entry) => entry.pid);
  } catch {
    return [];
  }
};

let pidPollTimer: NodeJS.Timeout | null = null;

const startPidPolling = (pid: number): void => {
  if (pidPollTimer) return;
  pidPollTimer = setInterval(() => {
    try {
      process.kill(pid, 0);
    } catch {
      if (pidPollTimer) {
        clearInterval(pidPollTimer);
        pidPollTimer = null;
      }
      void runCleanup().finally(() => exit(0));
    }
  }, PID_POLL_INTERVAL_MS);
};

const cleanupLocal = async (
  cfg: Extract<ShutdownSupervisorConfig, { kind: "LOCAL" }>,
) => {
  if (cfg.keepAlive) return;
  await cleanupLocalBrowser({
    killChrome: async () => {
      const pids = new Set<number>();
      if (cfg.pid) pids.add(cfg.pid);
      if (cfg.userDataDir) {
        for (const pid of findPidsByUserDataDir(cfg.userDataDir)) {
          pids.add(pid);
        }
      }
      for (const pid of pids) {
        await safeKill(pid);
      }
    },
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

const killLocalOnProcessExit = (): void => {
  const cfg = config;
  if (!cfg || !armed || cfg.kind !== "LOCAL") return;
  const pids = new Set<number>();
  if (cfg.pid) pids.add(cfg.pid);
  if (cfg.userDataDir) {
    for (const pid of findPidsByUserDataDir(cfg.userDataDir)) {
      pids.add(pid);
    }
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // best-effort
    }
  }
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
  try {
    process.stdout.write("ready\n");
  } catch {
    // ignore stdout failures
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
  process.on("exit", killLocalOnProcessExit);

  if (initialConfig) {
    notifyReady();
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
