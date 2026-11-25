import type Browserbase from "@browserbasehq/sdk";
import type { StagehandBrowser } from "@browserbasehq/stagehand";

import type { ForwardedEnv } from "./daemon/forwarded-env.js";
import type { DriverModeFlags } from "./mode.js";
import type { BrowserbaseIdentity, ConnectionTarget, RemoteConnectionTarget } from "./types.js";

export interface RemoteStagehandOptions {
  apiKey: string;
  browser: Browserbase.SessionCreateParams;
}

export interface RemoteBrowserLaunch {
  browser: StagehandBrowser;
  identity: BrowserbaseIdentity;
}

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

export interface DriverInitHints {
  chromeNotFound: string;
  repeatedInitFailure: string;
}

export interface RemoteCapability {
  resolveExplicitRemoteTarget(flags: DriverModeFlags): ConnectionTarget;
  autoSelectRemoteTarget(): ConnectionTarget | null;
  forwardedEnvKeys(): readonly string[];
  remoteStagehandOptions(
    target?: RemoteConnectionTarget,
    forwardedEnv?: ForwardedEnv,
  ): Promise<RemoteStagehandOptions>;
  launchRemoteBrowser(
    target?: RemoteConnectionTarget,
    forwardedEnv?: ForwardedEnv,
  ): Promise<RemoteBrowserLaunch>;
  remoteBrowserbaseIdentity(
    sessionId: string,
    forwardedEnv?: ForwardedEnv,
  ): Promise<BrowserbaseIdentity>;
  classifyRemoteInitError(error: unknown): RemoteInitErrorClassification;
  driverInitHints(): DriverInitHints;
  remoteDoctorCheck(env: NodeJS.ProcessEnv): RemoteDoctorResult;
}
