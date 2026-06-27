import type { Stagehand } from "@browserbasehq/stagehand";

import type { ForwardedCredentials } from "./daemon/credentials.js";
import type { DriverModeFlags } from "./mode.js";
import type { ConnectionTarget } from "./types.js";

export type StagehandConstructorOptions = ConstructorParameters<
  typeof Stagehand
>[0];

export interface RemoteDoctorResult {
  ok: boolean;
  message: string;
  fix?: string;
}

export interface RemoteInitErrorClassification {
  code: string;
  httpStatus?: number;
  message: string;
}

/**
 * Driver init remediation strings that may reference `BROWSERBASE_API_KEY`.
 * They live behind the remote capability so the local-only artifact contains
 * key-free variants (its build excludes `remote.ts` entirely).
 */
export interface DriverInitHints {
  /** Actionable message when no local Chrome can be found. */
  chromeNotFound: string;
  /** Suffix appended after repeated consecutive init failures. */
  repeatedInitFailure: string;
}

/**
 * The Browserbase (cloud) capability surface. The real implementation lives in
 * `remote.ts` and is the only place that reads `BROWSERBASE_API_KEY`. The
 * `build:local-only` build excludes `remote.ts` and resolves `remote.disabled.ts`
 * instead, so a local-only artifact contains no API-key code paths at all.
 */
export interface RemoteCapability {
  /** Resolve an explicit `--remote` request into a connection target. */
  resolveExplicitRemoteTarget(flags: DriverModeFlags): ConnectionTarget;
  /** Auto-select remote when an API key is present; null otherwise. */
  autoSelectRemoteTarget(): ConnectionTarget | null;
  /**
   * Env var names the client forwards to a running daemon (e.g. the API key)
   * so a key set after the daemon started is honored. Empty in the local-only
   * build, which never reaches the cloud.
   */
  forwardedCredentialKeys(): readonly string[];
  /**
   * Stagehand options for a remote (BROWSERBASE) session. Forwarded
   * credentials (if any) are threaded into the constructor here so a key set
   * after the daemon started is honored without touching `process.env`.
   */
  remoteStagehandOptions(
    credentials?: ForwardedCredentials,
  ): Promise<StagehandConstructorOptions>;
  /** Map a failed remote `stagehand.init()` to an actionable message + code. */
  classifyRemoteInitError(error: unknown): RemoteInitErrorClassification;
  /** Remediation strings for driver init failures. */
  driverInitHints(): DriverInitHints;
  /** Doctor readiness check for remote/Browserbase. */
  remoteDoctorCheck(env: NodeJS.ProcessEnv): RemoteDoctorResult;
}
