import { isDeepStrictEqual } from "node:util";

import { isAgentContext } from "../agent.js";
import { fail } from "../errors.js";
import { getRemote } from "./remote-binding.js";
import { resolveWsTarget } from "./resolve-ws.js";
import type { ConnectionTarget } from "./types.js";

export interface DriverModeFlags {
  "auto-connect"?: boolean;
  cdp?: string;
  "chrome-arg"?: string[];
  headed?: boolean;
  headless?: boolean;
  "ignore-default-chrome-arg"?: string[];
  local?: boolean;
  "no-default-chrome-args"?: boolean;
  remote?: boolean;
  "target-id"?: string;
}

interface ResolvedChromeArgs {
  args?: string[];
  ignoreDefaultArgs?: boolean | string[];
}

export function resolveHeadless(
  flags: Pick<DriverModeFlags, "headed" | "headless">,
): boolean {
  if (flags.headed && flags.headless) {
    fail("Pass either --headed or --headless, not both.");
  }

  if (flags.headed) return false;
  if (flags.headless) return true;
  // no explicit flag → default headed for an interactive human with a display, else headless
  return !shouldDefaultHeaded();
}

/**
 * Decide whether a managed local session should default to a visible (headed)
 * window when neither --headed nor --headless was passed.
 *
 * The "wow moment" of `browse open` is a human watching a real browser drive
 * itself, so an interactive human at a terminal with a display gets a headed
 * window. Agents, CI, piped/non-interactive shells, and machines without a
 * display server stay headless so automation never spawns a stray window or
 * breaks where no display exists.
 */
export function shouldDefaultHeaded(): boolean {
  if (isAgentContext()) return false; // agent-driven → headless
  if (!process.stdout.isTTY) return false; // piped / non-interactive / CI → headless
  if (process.env.CI) return false; // CI → headless
  if (!hasDisplay()) return false; // no display server → headless
  return true;
}

/**
 * Best-effort check for whether a GUI can be shown. On Linux we read the X11 /
 * Wayland display vars, which is the canonical signal. macOS/Windows have no
 * such env var, so we assume a display is present — this is right for the
 * overwhelming common case (a dev on a laptop) but can be a false positive for
 * a human SSH'd into a headless macOS/Windows box with no console session,
 * where headed Chrome may fail to launch. That case is rare and recoverable
 * with an explicit `--headless`; if it shows up in telemetry we can revisit.
 */
export function hasDisplay(): boolean {
  if (process.platform === "darwin" || process.platform === "win32")
    return true;
  // linux/other: require an X11 or Wayland display server
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

export function hasChromeArgFlags(flags: DriverModeFlags): boolean {
  return chromeArgFlagsInUse(flags).length > 0;
}

function chromeArgFlagsInUse(flags: DriverModeFlags): string[] {
  const names: string[] = [];
  if (flags["chrome-arg"]?.length) names.push("--chrome-arg");
  if (flags["ignore-default-chrome-arg"]?.length)
    names.push("--ignore-default-chrome-arg");
  if (flags["no-default-chrome-args"]) names.push("--no-default-chrome-args");
  return names;
}

export async function resolveConnectionTarget(
  flags: DriverModeFlags,
): Promise<ConnectionTarget> {
  const chromeArgFlags = chromeArgFlagsInUse(flags);

  if (flags.cdp) {
    failOnConflictingFlags("--cdp", [
      flags["auto-connect"] ? "--auto-connect" : null,
      ...chromeArgFlags,
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
      ...chromeArgFlags,
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
      ...chromeArgFlags,
      flags.headed ? "--headed" : null,
      flags.headless ? "--headless" : null,
    ]);
    return (await getRemote()).resolveExplicitRemoteTarget(flags);
  }

  if (flags.local) {
    return managedLocalTarget(resolveHeadless(flags), resolveChromeArgs(flags));
  }

  const autoRemote = (await getRemote()).autoSelectRemoteTarget();
  if (autoRemote) {
    failOnConflictingFlags("remote mode", [
      ...chromeArgFlags,
      flags.headed ? "--headed" : null,
      flags.headless ? "--headless" : null,
    ]);
    return autoRemote;
  }

  return managedLocalTarget(resolveHeadless(flags), resolveChromeArgs(flags));
}

function managedLocalTarget(
  headless: boolean,
  chromeArgs: ResolvedChromeArgs,
): ConnectionTarget {
  return {
    ...(chromeArgs.args?.length ? { chromeArgs: chromeArgs.args } : {}),
    ...(chromeArgs.ignoreDefaultArgs !== undefined
      ? { ignoreDefaultArgs: chromeArgs.ignoreDefaultArgs }
      : {}),
    kind: "managed-local",
    headless,
  };
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

function resolveChromeArgs(flags: DriverModeFlags): ResolvedChromeArgs {
  const args = flags["chrome-arg"]?.filter((arg) => arg.length > 0);
  const ignoreDefaults = flags["ignore-default-chrome-arg"]?.filter(
    (arg) => arg.length > 0,
  );
  const noDefaults = flags["no-default-chrome-args"] === true;

  if (noDefaults && ignoreDefaults?.length) {
    fail(
      "--no-default-chrome-args cannot be combined with --ignore-default-chrome-arg.",
    );
  }

  const resolved: ResolvedChromeArgs = {};
  if (args?.length) resolved.args = args;
  if (noDefaults) {
    resolved.ignoreDefaultArgs = true;
  } else if (ignoreDefaults?.length) {
    resolved.ignoreDefaultArgs = ignoreDefaults;
  }
  return resolved;
}

export function targetsCompatible(
  left: ConnectionTarget,
  right: ConnectionTarget,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "managed-local" && right.kind === "managed-local")
    return (
      left.headless === right.headless &&
      chromeArgsEqual(left.chromeArgs, right.chromeArgs) &&
      ignoreDefaultArgsEqual(left.ignoreDefaultArgs, right.ignoreDefaultArgs)
    );
  if (left.kind === "cdp" && right.kind === "cdp") {
    return left.endpoint === right.endpoint && left.targetId === right.targetId;
  }
  return true;
}

function chromeArgsEqual(left?: string[], right?: string[]): boolean {
  return isDeepStrictEqual(left ?? [], right ?? []);
}

function ignoreDefaultArgsEqual(
  left?: boolean | string[],
  right?: boolean | string[],
): boolean {
  if (left === true || right === true) return left === right;
  return chromeArgsEqual(
    Array.isArray(left) ? left : undefined,
    Array.isArray(right) ? right : undefined,
  );
}
