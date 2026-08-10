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
import { createRequire } from "node:module";
import type {
  ShutdownSupervisorConfig,
  ShutdownSupervisorHandle,
} from "../types/private/shutdown.js";
import {
  ShutdownSupervisorResolveError,
  ShutdownSupervisorSpawnError,
} from "../types/private/shutdownErrors.js";
import { getCurrentFilePath } from "../runtimePaths.js";

const moduleFilename = getCurrentFilePath();
const moduleDir = path.dirname(moduleFilename);
const nodeRequire = createRequire(moduleFilename);

const isSeaRuntime = (): boolean => {
  try {
    const sea = nodeRequire("node:sea") as { isSea?: () => boolean };
    return Boolean(sea.isSea?.());
  } catch {
    return false;
  }
};

// SEA: re-exec current binary with supervisor args.
// Non-SEA: execute Stagehand CLI entrypoint with supervisor args.
const resolveCliPath = (): string => `${moduleDir}/../cli.js`;

const resolveSupervisorCommand = (
  config: ShutdownSupervisorConfig,
): {
  command: string;
  args: string[];
} | null => {
  const baseArgs = ["--supervisor", serializeConfigArg(config)];

  if (isSeaRuntime()) {
    return { command: process.execPath, args: baseArgs };
  }

  const cliPath = resolveCliPath();
  if (!fs.existsSync(cliPath)) return null;
  const needsTsxLoader =
    fs.existsSync(`${moduleDir}/supervisor.ts`) &&
    !fs.existsSync(`${moduleDir}/supervisor.js`);
  return {
    command: process.execPath,
    args: needsTsxLoader
      ? ["--import", "tsx", cliPath, ...baseArgs]
      : [cliPath, ...baseArgs],
  };
};

// Single JSON arg keeps supervisor bootstrap parsing tiny and versionable.
const serializeConfigArg = (config: ShutdownSupervisorConfig): string =>
  `--supervisor-config=${JSON.stringify({
    ...config,
    parentPid: process.pid,
  })}`;

/**
 * Start a supervisor process for crash cleanup. Returns a handle that can
 * stop the supervisor during a normal shutdown.
 */
export function startShutdownSupervisor(
  config: ShutdownSupervisorConfig,
  opts?: { onError?: (error: Error, context: string) => void },
): ShutdownSupervisorHandle | null {
  const resolved = resolveSupervisorCommand(config);
  if (!resolved) {
    opts?.onError?.(
      new ShutdownSupervisorResolveError(
        "Shutdown supervisor entry missing (expected Stagehand CLI entrypoint).",
      ),
      "resolve",
    );
    return null;
  }

  const child = spawn(resolved.command, resolved.args, {
    // stdin is the parent lifeline.
    // Preserve supervisor stderr so crash-cleanup debug lines are visible.
    stdio: ["pipe", "ignore", "inherit"],
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

  const stop = () => {
    // Normal close path: terminate supervisor directly.
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  };

  return { stop };
}
