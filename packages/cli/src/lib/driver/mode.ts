import { fail } from "../errors.js";
import { getRemote } from "./remote-binding.js";
import { resolveWsTarget } from "./resolve-ws.js";
import type { ConnectionTarget, ManagedLocalLaunchOptions } from "./types.js";

export interface DriverModeFlags {
  "auto-connect"?: boolean;
  "chrome-arg"?: string[];
  "chrome-path"?: string;
  cdp?: string;
  "connect-timeout"?: number;
  headed?: boolean;
  headless?: boolean;
  local?: boolean;
  remote?: boolean;
  "target-id"?: string;
}

function resolveHeadless(
  flags: Pick<DriverModeFlags, "headed" | "headless">,
): boolean {
  if (flags.headed && flags.headless) {
    fail("Pass either --headed or --headless, not both.");
  }

  if (flags.headed) return false;
  if (flags.headless) return true;
  return true;
}

export async function resolveConnectionTarget(
  flags: DriverModeFlags,
): Promise<ConnectionTarget> {
  failOnConflictingLocalLaunchFlags(flags);

  if (flags.cdp) {
    failOnConflictingFlags("--cdp", [
      flags["auto-connect"] ? "--auto-connect" : null,
      flags.local ? "--local" : null,
      flags.remote ? "--remote" : null,
      flags.headed ? "--headed" : null,
      flags.headless ? "--headless" : null,
    ]);
    return {
      kind: "cdp",
      endpoint: await resolveWsTarget(flags.cdp),
      targetId: flags["target-id"],
    };
  }

  if (flags["target-id"]) {
    fail("--target-id requires --cdp.");
  }

  if (flags["auto-connect"]) {
    failOnConflictingFlags("--auto-connect", [
      flags.local ? "--local" : null,
      flags.remote ? "--remote" : null,
      flags.headed ? "--headed" : null,
      flags.headless ? "--headless" : null,
    ]);
    return { kind: "auto-connect" };
  }

  if (flags.local && flags.remote) {
    fail("Pass either --local or --remote, not both.");
  }

  if (flags.remote) {
    failOnConflictingFlags("--remote", [
      flags.headed ? "--headed" : null,
      flags.headless ? "--headless" : null,
    ]);
    return (await getRemote()).resolveExplicitRemoteTarget(flags);
  }

  if (flags.local) {
    return buildManagedLocalTarget(flags);
  }

  const autoRemote = (await getRemote()).autoSelectRemoteTarget();
  if (autoRemote) {
    failOnConflictingFlags("remote mode", [
      flags.headed ? "--headed" : null,
      flags.headless ? "--headless" : null,
    ]);
    return autoRemote;
  }

  return buildManagedLocalTarget(flags);
}

function buildManagedLocalTarget(
  flags: DriverModeFlags,
): Extract<ConnectionTarget, { kind: "managed-local" }> {
  const launch = resolveManagedLocalLaunch(flags);
  return {
    headless: resolveHeadless(flags),
    kind: "managed-local",
    ...(launch ? { launch } : {}),
  };
}

function resolveManagedLocalLaunch(
  flags: DriverModeFlags,
): ManagedLocalLaunchOptions | undefined {
  const executablePath = flags["chrome-path"] ?? process.env.CHROME_PATH;
  const connectTimeoutMs = flags["connect-timeout"];
  const args = flags["chrome-arg"]?.filter(Boolean);

  if (!executablePath && connectTimeoutMs === undefined && !args?.length) {
    return undefined;
  }

  return {
    ...(executablePath ? { executablePath } : {}),
    ...(connectTimeoutMs !== undefined ? { connectTimeoutMs } : {}),
    ...(args?.length ? { args } : {}),
  };
}

function failOnConflictingLocalLaunchFlags(flags: DriverModeFlags): void {
  const hasLaunchFlags = Boolean(
    flags["chrome-path"] ||
      flags["connect-timeout"] !== undefined ||
      flags["chrome-arg"]?.length,
  );
  if (!hasLaunchFlags) return;

  failOnConflictingFlags("--chrome-path", [
    flags.cdp ? "--cdp" : null,
    flags["auto-connect"] ? "--auto-connect" : null,
    flags.remote ? "--remote" : null,
  ]);
  failOnConflictingFlags("--connect-timeout", [
    flags.cdp ? "--cdp" : null,
    flags["auto-connect"] ? "--auto-connect" : null,
    flags.remote ? "--remote" : null,
  ]);
  failOnConflictingFlags("--chrome-arg", [
    flags.cdp ? "--cdp" : null,
    flags["auto-connect"] ? "--auto-connect" : null,
    flags.remote ? "--remote" : null,
  ]);
}

function failOnConflictingFlags(
  flag: string,
  candidates: Array<string | null>,
): void {
  const conflicts = candidates.filter((candidate): candidate is string =>
    Boolean(candidate),
  );
  if (conflicts.length > 0)
    fail(`${flag} cannot be combined with ${conflicts.join(", ")}.`);
}

export function targetsCompatible(
  left: ConnectionTarget,
  right: ConnectionTarget,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "managed-local" && right.kind === "managed-local") {
    return (
      left.headless === right.headless &&
      managedLocalLaunchCompatible(left.launch, right.launch)
    );
  }
  if (left.kind === "cdp" && right.kind === "cdp") {
    return left.endpoint === right.endpoint && left.targetId === right.targetId;
  }
  return true;
}

function managedLocalLaunchCompatible(
  left?: ManagedLocalLaunchOptions,
  right?: ManagedLocalLaunchOptions,
): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;

  return (
    left.executablePath === right.executablePath &&
    left.connectTimeoutMs === right.connectTimeoutMs &&
    JSON.stringify(left.args ?? []) === JSON.stringify(right.args ?? [])
  );
}
