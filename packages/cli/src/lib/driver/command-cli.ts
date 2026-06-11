import { Flags } from "@oclif/core";

import type { DriverCommandName } from "./commands/types.js";
import {
  autoConnectFlag,
  cdpFlag,
  headedFlag,
  headlessFlag,
  localFlag,
  remoteFlag,
  sessionFlag,
  sessionName,
  targetIdFlag,
} from "./flags.js";
import { getDriverStatus } from "./daemon/client.js";
import { resolveConnectionTarget, type DriverModeFlags } from "./mode.js";
import type { ConnectionTarget } from "./types.js";
import { outputJson } from "../output.js";
import { runDriverCommandWithTarget } from "./runtime.js";

export const clipboardScopeNote =
  "Clipboard scope depends on the session target: Browserbase remote sessions and managed headless local sessions use an isolated per-browser clipboard, while headed local sessions and --cdp attachments share the machine's OS clipboard with every other app and session on that machine.";

export const driverCommandFlags = {
  "auto-connect": autoConnectFlag,
  cdp: cdpFlag,
  headed: headedFlag,
  headless: headlessFlag,
  local: localFlag,
  remote: remoteFlag,
  session: sessionFlag,
  "target-id": targetIdFlag,
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
  const session = sessionName(flags.session);
  const target = await resolveTargetForCommand(session, flags);
  outputJson(
    await runDriverCommandWithTarget(session, target, command, params),
  );
}

export async function resolveTargetForCommand(
  session: string,
  flags: DriverFlags,
) {
  const hasExplicitTarget = hasExplicitDriverTarget(flags);
  if (!hasExplicitTarget || hasModeOnlyFlag(flags)) {
    const status = await getDriverStatus(session);
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
      flags["target-id"] ||
      flags.headed ||
      flags.headless,
  );
}

function hasModeOnlyFlag(flags: DriverFlags): boolean {
  return Boolean(
    (flags.local || flags.remote) &&
      !flags["auto-connect"] &&
      !flags.cdp &&
      !flags["target-id"] &&
      !flags.headed &&
      !flags.headless &&
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
