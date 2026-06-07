import type { LocalBrowserLaunchOptions } from "@browserbasehq/stagehand";

import type { ManagedLocalLaunchOptions } from "./types.js";

export function buildManagedLocalLaunchOptions(
  launch?: ManagedLocalLaunchOptions,
): LocalBrowserLaunchOptions {
  return {
    ...(launch?.executablePath
      ? { executablePath: launch.executablePath }
      : {}),
    ...(typeof launch?.connectTimeoutMs === "number"
      ? { connectTimeoutMs: launch.connectTimeoutMs }
      : {}),
    ...(launch?.args?.length ? { args: launch.args } : {}),
  };
}
