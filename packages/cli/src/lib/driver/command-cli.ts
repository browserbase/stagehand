import { Flags } from "@oclif/core";

import type { DriverCommandName } from "./commands/types.js";
import {
  autoConnectFlag,
  cdpFlag,
  chromeArgFlag,
  headedFlag,
  headlessFlag,
  ignoreDefaultChromeArgFlag,
  localFlag,
  noDefaultChromeArgsFlag,
  proxiesFlag,
  remoteFlag,
  resolveSession,
  sessionFlag,
  targetIdFlag,
  verifiedFlag,
  type SessionRole,
} from "./flags.js";
import { getDriverStatus } from "./daemon/client.js";
import {
  hasChromeArgFlags,
  resolveConnectionTarget,
  type DriverModeFlags,
} from "./mode.js";
import type { ConnectionTarget, DriverStatus } from "./types.js";
import { outputJson } from "../output.js";
import { runDriverCommandWithTarget } from "./runtime.js";

export const driverCommandFlags = {
  "auto-connect": autoConnectFlag,
  cdp: cdpFlag,
  "chrome-arg": chromeArgFlag,
  headed: headedFlag,
  headless: headlessFlag,
  "ignore-default-chrome-arg": ignoreDefaultChromeArgFlag,
  local: localFlag,
  "no-default-chrome-args": noDefaultChromeArgsFlag,
  proxies: proxiesFlag,
  remote: remoteFlag,
  session: sessionFlag,
  "target-id": targetIdFlag,
  verified: verifiedFlag,
};

export const waitUntilFlag = Flags.string({
  default: "load",
  description: "Load state to wait for before returning.",
  helpValue: "<state>",
  options: ["load", "domcontentloaded", "networkidle"],
});

export const timeoutMsFlag = Flags.integer({
  default: 30_000,
  description: "Timeout in milliseconds.",
  helpValue: "<ms>",
});

export const buttonFlag = Flags.string({
  default: "left",
  description: "Mouse button to use.",
  helpValue: "<button>",
  options: ["left", "middle", "right"],
});

export type DriverFlags = DriverModeFlags & {
  session?: string;
};

export async function runDriverCommandFromFlags(
  command: DriverCommandName,
  params: unknown,
  flags: DriverFlags,
): Promise<void> {
  // `open` with no explicit session always mints a fresh one (never attaches
  // implicitly — that would let a second agent clobber the first). Every
  // other driver command resolves against the currently running session(s).
  const role: SessionRole = command === "open" ? "open" : "attach";
  const resolved = await resolveSession(flags.session, role);
  const target = await resolveTargetForCommand(
    resolved.session,
    flags,
    resolved.status,
  );
  const result = await runDriverCommandWithTarget(
    resolved.session,
    target,
    command,
    params,
  );
  if (resolved.generated) {
    notifyGeneratedSession(resolved.session);
  }
  outputJson(result);
}

function notifyGeneratedSession(session: string): void {
  process.stderr.write(
    `Started new session "${session}". Use --session ${session} (or BROWSE_SESSION) to address this browser in follow-up commands; commands without --session find it automatically while it is the only running session.\n`,
  );
}

export async function resolveTargetForCommand(
  session: string,
  flags: DriverFlags,
  knownStatus?: DriverStatus | null,
) {
  const hasExplicitTarget = hasExplicitDriverTarget(flags);
  if (!hasExplicitTarget || hasModeOnlyFlag(flags)) {
    const status =
      knownStatus !== undefined ? knownStatus : await getDriverStatus(session);
    if (
      status?.target &&
      (!hasExplicitTarget || targetMatchesRequestedMode(status.target, flags))
    ) {
      return status.target;
    }
  }

  return resolveConnectionTarget(flags);
}

export function hasExplicitDriverTarget(flags: DriverFlags): boolean {
  return Boolean(
    flags.local ||
      flags.remote ||
      flags["auto-connect"] ||
      flags.cdp ||
      hasChromeArgFlags(flags) ||
      flags["target-id"] ||
      flags.headed ||
      flags.headless ||
      flags.verified ||
      flags.proxies,
  );
}

function hasModeOnlyFlag(flags: DriverFlags): boolean {
  return Boolean(
    (flags.local || flags.remote) &&
      !flags["auto-connect"] &&
      !flags.cdp &&
      !hasChromeArgFlags(flags) &&
      !flags["target-id"] &&
      !flags.headed &&
      !flags.headless &&
      !flags.verified &&
      !flags.proxies &&
      flags.local !== flags.remote,
  );
}

function targetMatchesRequestedMode(
  target: ConnectionTarget,
  flags: DriverFlags,
): boolean {
  if (flags.local) return target.kind === "managed-local";
  if (flags.remote) return target.kind === "remote";
  return false;
}

export function parseClip(
  value: string | undefined,
): { height: number; width: number; x: number; y: number } | undefined {
  if (!value) return undefined;
  const match = value.match(
    /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/,
  );
  if (!match) {
    throw new Error(
      "Invalid clip. Use x,y,width,height, for example 0,0,800,600.",
    );
  }

  const [, x, y, width, height] = match;
  return {
    height: Number.parseFloat(height!),
    width: Number.parseFloat(width!),
    x: Number.parseFloat(x!),
    y: Number.parseFloat(y!),
  };
}

export function parseNumber(value: string, name: string): number {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${name} must be a number.`);
  }
  return number;
}

export function parseInteger(value: string, name: string): number {
  const number = parseNumber(value, name);
  if (!Number.isInteger(number)) {
    throw new Error(`${name} must be an integer.`);
  }
  return number;
}
