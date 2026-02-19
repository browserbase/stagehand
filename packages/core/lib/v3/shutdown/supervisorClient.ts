/**
 * Parent-side helper for spawning the shutdown supervisor process.
 *
 * The supervisor runs out-of-process and watches a lifeline pipe. If the parent
 * dies, the supervisor performs best-effort cleanup (Chrome kill or Browserbase
 * session release) when keepAlive is false.
 */

import fs from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type {
  ShutdownSupervisorConfig,
  ShutdownSupervisorHandle,
  ShutdownSupervisorMessage,
} from "../types/private/shutdown.js";
import {
  ShutdownSupervisorResolveError,
  ShutdownSupervisorSpawnError,
} from "../types/private/shutdownErrors.js";

const READY_TIMEOUT_MS = 500;
const normalizedFilename =
  typeof __filename === "string" ? __filename.replaceAll("\\", "/") : "";
const hasAbsoluteFilename =
  normalizedFilename.startsWith("/") || /^[A-Za-z]:\//.test(normalizedFilename);
const modulePath = hasAbsoluteFilename
  ? __filename
  : fileURLToPath(import.meta.url);
const normalizedModulePath = modulePath.replaceAll("\\", "/");
const moduleDir = normalizedModulePath.slice(
  0,
  normalizedModulePath.lastIndexOf("/"),
);
const require = createRequire(modulePath);

const isSeaRuntime = (): boolean => {
  try {
    const sea = require("node:sea") as { isSea?: () => boolean };
    return Boolean(sea.isSea?.());
  } catch {
    return false;
  }
};

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

  const cliPathCandidates = [`${moduleDir}/../cli.js`, `${moduleDir}/cli.js`];
  const cliPath =
    cliPathCandidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  if (!cliPath) return null;
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

const serializeConfigArg = (config: ShutdownSupervisorConfig): string =>
  `--supervisor-config=${JSON.stringify({
    ...config,
    keepAlive: false,
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
