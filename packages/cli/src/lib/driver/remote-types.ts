import type { Stagehand } from "@browserbasehq/stagehand";

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
  /** Stagehand options for a remote (BROWSERBASE) session. */
  remoteStagehandOptions(): StagehandConstructorOptions;
  /** Doctor readiness check for remote/Browserbase. */
  remoteDoctorCheck(env: NodeJS.ProcessEnv): RemoteDoctorResult;
}
