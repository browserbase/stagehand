import type {
  RemoteDoctorResult,
  StagehandConstructorOptions,
} from "./remote-types.js";
import type { ConnectionTarget } from "./types.js";

/**
 * Real Browserbase capability. This is the ONLY module that reads
 * `BROWSERBASE_API_KEY`; it is excluded from `build:local-only` so that
 * local-only artifacts cannot reach Browserbase.
 */

export function resolveExplicitRemoteTarget(): ConnectionTarget {
  return { kind: "remote" };
}

export function autoSelectRemoteTarget(): ConnectionTarget | null {
  return process.env.BROWSERBASE_API_KEY ? { kind: "remote" } : null;
}

export function remoteStagehandOptions(): StagehandConstructorOptions {
  const apiKey = process.env.BROWSERBASE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Missing BROWSERBASE_API_KEY for remote mode. Pass --local to run a managed local browser (no key needed), or set BROWSERBASE_API_KEY for cloud sessions.",
    );
  }

  return {
    apiKey,
    browserbaseSessionCreateParams: {
      userMetadata: { browse_cli: "true" },
    },
    disableAPI: true,
    disablePino: true,
    env: "BROWSERBASE",
    verbose: 0,
  };
}

export function remoteDoctorCheck(env: NodeJS.ProcessEnv): RemoteDoctorResult {
  if (env.BROWSERBASE_API_KEY) {
    return { ok: true, message: "BROWSERBASE_API_KEY is set" };
  }

  return {
    ok: false,
    message: "BROWSERBASE_API_KEY is not set",
    fix: "export BROWSERBASE_API_KEY=...",
  };
}
