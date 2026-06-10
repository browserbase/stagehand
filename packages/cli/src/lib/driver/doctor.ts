import { promises as fs } from "node:fs";

import { CommandFailure } from "../errors.js";
import { getDriverStatus } from "./daemon/client.js";
import {
  getLockPath,
  getPidPath,
  getSocketPath,
  runtimeDir,
} from "./daemon/paths.js";
import { isProcessAlive } from "./daemon/process.js";
import {
  discoverLocalCdp,
  type LocalCdpDiscovery,
} from "./local-cdp-discovery.js";
import { hasExplicitDriverTarget, type DriverFlags } from "./command-cli.js";
import { resolveConnectionTarget, targetsCompatible } from "./mode.js";
import { getRemote } from "./remote-binding.js";
import type { ConnectionTarget, DriverStatus } from "./types.js";

export type DoctorCheckStatus = "ok" | "warn" | "fail" | "skip";
export type DoctorVerdict = "ok" | "warn" | "fail";

export interface DoctorCheck {
  details?: Record<string, unknown>;
  fix?: string;
  message: string;
  name: string;
  status: DoctorCheckStatus;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  next?: string;
  paths: {
    lock: string;
    pid: string;
    runtimeDir: string;
    socket: string;
  };
  session: string;
  target?: ConnectionTarget;
  verdict: DoctorVerdict;
}

export interface BuildDoctorReportOptions {
  flags: DriverFlags;
  session: string;
}

export interface DoctorDeps {
  discoverLocalCdp?: typeof discoverLocalCdp;
  env?: NodeJS.ProcessEnv;
  getDriverStatus?: typeof getDriverStatus;
  isProcessAlive?: (pid: number) => boolean;
  readPackageVersion?: () => Promise<string>;
  resolveConnectionTarget?: typeof resolveConnectionTarget;
}

interface DaemonInspection {
  alivePid?: number;
  lock?: "active" | "stale" | "unreadable";
}

const DEFAULT_URL = "https://example.com";

export async function buildDoctorReport(
  options: BuildDoctorReportOptions,
  deps: DoctorDeps = {},
): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const env = deps.env ?? process.env;
  const getStatus = deps.getDriverStatus ?? getDriverStatus;
  const resolveTarget = deps.resolveConnectionTarget ?? resolveConnectionTarget;
  const packageVersion = await (
    deps.readPackageVersion ?? readPackageVersion
  )();

  checks.push({
    details: { node: process.version, version: packageVersion },
    message: `browse ${packageVersion}, node ${process.version}`,
    name: "runtime",
    status: "ok",
  });

  checks.push({
    message: options.session,
    name: "session",
    status: "ok",
  });

  const paths = {
    lock: getLockPath(options.session),
    pid: getPidPath(options.session),
    runtimeDir: runtimeDir(),
    socket: getSocketPath(options.session),
  };

  const status = await getStatus(options.session).catch((error: unknown) => {
    checks.push({
      details: { error: errorMessage(error) },
      fix: `browse stop --session ${options.session} --force`,
      message: `could not read daemon status: ${errorMessage(error)}`,
      name: "daemon",
      status: "fail",
    });
    return null;
  });

  if (!checks.some((check) => check.name === "daemon")) {
    checks.push(await daemonCheck(options.session, status, paths, deps));
  }

  const explicitTarget = hasExplicitDriverTarget(options.flags);
  let target: ConnectionTarget | undefined;
  let targetFailed = false;

  if (status?.target && !explicitTarget) {
    target = status.target;
    checks.push({
      details: { target },
      message: `reusing ${formatTarget(target)}`,
      name: "target",
      status: "ok",
    });
  } else {
    try {
      target = await resolveTarget(options.flags);
      const incompatible =
        status?.target && !targetsCompatible(status.target, target);
      if (incompatible) {
        targetFailed = true;
        checks.push({
          details: { requested: target, running: status.target },
          fix: `browse stop --session ${options.session}`,
          message: `session is already using ${formatTarget(status.target)}, requested ${formatTarget(target)}`,
          name: "target",
          status: "fail",
        });
      } else {
        checks.push({
          details: { target },
          message: status?.target
            ? `matches running ${formatTarget(target)}`
            : formatTarget(target),
          name: "target",
          status: "ok",
        });
      }
    } catch (error) {
      targetFailed = true;
      checks.push({
        message: errorMessage(error),
        name: "target",
        status: "fail",
      });
    }
  }

  if (target && !targetFailed && !status) {
    const modeCheck = await checkTargetPrerequisite(
      target,
      options.flags,
      options.session,
      env,
      deps,
    );
    if (modeCheck) checks.push(modeCheck);
  }

  const verdict = reportVerdict(checks);
  return {
    checks,
    next: nextStep(
      verdict,
      checks,
      target,
      options.flags,
      options.session,
      status,
    ),
    paths,
    session: options.session,
    target,
    verdict,
  };
}

export function renderDoctorReport(report: DoctorReport): string {
  const lines = ["Browse doctor", ""];
  const width = Math.max(...report.checks.map((check) => check.name.length), 7);

  for (const check of report.checks) {
    lines.push(
      `${statusLabel(check.status)} ${check.name.padEnd(width)} ${check.message}`,
    );
  }

  lines.push("", `Status: ${report.verdict}`);
  const fix =
    report.checks.find((check) => check.status === "fail" && check.fix)?.fix ??
    report.checks.find((check) => check.status === "warn" && check.fix)?.fix;
  if (fix) {
    lines.push(`Fix: ${fix}`);
  } else if (report.next) {
    lines.push(`Next: ${report.next}`);
  }
  return lines.join("\n");
}

async function daemonCheck(
  session: string,
  status: DriverStatus | null,
  paths: DoctorReport["paths"],
  deps: DoctorDeps,
): Promise<DoctorCheck> {
  if (status) {
    const pageCount = status.pages.length;
    const state = status.initialized
      ? `connected, ${pageCount} page${pageCount === 1 ? "" : "s"}`
      : "running";
    return {
      details: { mode: status.mode, pid: status.pid },
      message: `${state}, pid ${status.pid}`,
      name: "daemon",
      status: "ok",
    };
  }

  const inspection = await inspectDaemonFiles(paths, deps);
  if (inspection.alivePid) {
    return {
      details: { pid: inspection.alivePid },
      fix: `browse stop --session ${session} --force`,
      message: "pid file exists but daemon is not responding",
      name: "daemon",
      status: "fail",
    };
  }

  if (inspection.lock === "stale") {
    return {
      fix: `browse stop --session ${session} --force`,
      message: "stale lock file detected",
      name: "daemon",
      status: "warn",
    };
  }

  if (inspection.lock === "active") {
    return {
      message: "daemon startup lock is currently held",
      name: "daemon",
      status: "warn",
    };
  }

  return {
    message: "no active daemon",
    name: "daemon",
    status: "ok",
  };
}

async function checkTargetPrerequisite(
  target: ConnectionTarget,
  flags: DriverFlags,
  session: string,
  env: NodeJS.ProcessEnv,
  deps: DoctorDeps,
): Promise<DoctorCheck | null> {
  if (target.kind === "managed-local") {
    return {
      message: target.headless
        ? "managed local browser, headless"
        : "managed local browser, headed",
      name: "browser",
      status: "ok",
    };
  }

  if (target.kind === "remote") {
    const result = (await getRemote()).remoteDoctorCheck(env);
    return {
      ...(result.fix ? { fix: result.fix } : {}),
      message: result.message,
      name: "browserbase",
      status: result.ok ? "ok" : "fail",
    };
  }

  if (target.kind === "auto-connect") {
    const discovered = await (deps.discoverLocalCdp ?? discoverLocalCdp)();
    if (discovered) {
      return {
        details: { source: discovered.source, wsUrl: discovered.wsUrl },
        message: `found local browser via ${formatDiscoverySource(discovered)}`,
        name: "cdp",
        status: "ok",
      };
    }

    return {
      fix: "start Chrome with --remote-debugging-port=9222",
      message: "no debuggable local browser found",
      name: "cdp",
      status: "fail",
    };
  }

  if (target.kind === "cdp") {
    return {
      details: { endpoint: target.endpoint, targetId: target.targetId },
      message: `resolved ${target.endpoint}${flags["target-id"] ? ` target ${flags["target-id"]}` : ""}`,
      name: "cdp",
      status: "ok",
    };
  }

  return null;
}

async function inspectDaemonFiles(
  paths: DoctorReport["paths"],
  deps: DoctorDeps,
): Promise<DaemonInspection> {
  const isAlive = deps.isProcessAlive ?? isProcessAlive;
  const inspection: DaemonInspection = {};

  const pid = await readPositiveInteger(paths.pid);
  if (pid && isAlive(pid)) {
    inspection.alivePid = pid;
  }

  const lockPid = await readPositiveInteger(paths.lock);
  if (lockPid) {
    inspection.lock = isAlive(lockPid) ? "active" : "stale";
  } else if (await exists(paths.lock)) {
    inspection.lock = "unreadable";
  }

  return inspection;
}

async function readPositiveInteger(file: string): Promise<number | null> {
  try {
    const value = Number((await fs.readFile(file, "utf8")).trim());
    return Number.isInteger(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function readPackageVersion(): Promise<string> {
  try {
    const pkg = JSON.parse(
      await fs.readFile(
        new URL("../../../package.json", import.meta.url),
        "utf8",
      ),
    ) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
}

function reportVerdict(checks: DoctorCheck[]): DoctorVerdict {
  if (checks.some((check) => check.status === "fail")) return "fail";
  if (checks.some((check) => check.status === "warn")) return "warn";
  return "ok";
}

function nextStep(
  verdict: DoctorVerdict,
  checks: DoctorCheck[],
  target: ConnectionTarget | undefined,
  flags: DriverFlags,
  session: string,
  status: DriverStatus | null,
): string | undefined {
  if (verdict !== "ok" || !target) return undefined;
  if (status && !hasExplicitDriverTarget(flags)) {
    return session === "default"
      ? "browse status"
      : `browse status --session ${session}`;
  }

  const parts = ["browse open", DEFAULT_URL];
  if (target.kind === "remote") parts.push("--remote");
  if (target.kind === "auto-connect") parts.push("--auto-connect");
  if (target.kind === "cdp") {
    parts.push("--cdp", flags.cdp ?? target.endpoint);
    if (target.targetId) parts.push("--target-id", target.targetId);
  }
  if (target.kind === "managed-local") {
    parts.push("--local");
    if (!target.headless) parts.push("--headed");
  }
  if (session !== "default") parts.push("--session", session);
  if (
    checks.some(
      (check) =>
        check.name === "browser" ||
        check.name === "browserbase" ||
        check.name === "cdp",
    )
  ) {
    return parts.join(" ");
  }
  return undefined;
}

function formatTarget(target: ConnectionTarget): string {
  if (target.kind === "managed-local")
    return `managed-local, ${target.headless ? "headless" : "headed"}`;
  if (target.kind === "cdp")
    return target.targetId ? `cdp, target ${target.targetId}` : "cdp";
  return target.kind;
}

function formatDiscoverySource(discovered: LocalCdpDiscovery): string {
  return discovered.source.startsWith("DevToolsActivePort:")
    ? "DevToolsActivePort"
    : discovered.source;
}

function statusLabel(status: DoctorCheckStatus): string {
  if (status === "ok") return "[ok]  ";
  if (status === "warn") return "[warn]";
  if (status === "fail") return "[fail]";
  return "[skip]";
}

function errorMessage(error: unknown): string {
  if (error instanceof CommandFailure) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
