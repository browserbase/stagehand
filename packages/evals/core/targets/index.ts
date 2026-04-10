import type { StartupProfile, ToolSurface } from "../contracts/tool.js";
import { launchRunnerProvidedBrowserbaseChrome } from "./browserbase.js";
import { launchRunnerProvidedLocalChrome } from "./localChrome.js";

export interface PreparedCoreBrowserTarget {
  providedEndpoint?: {
    kind: "ws" | "http";
    url: string;
    headers?: Record<string, string>;
  };
  metadata?: Record<string, unknown>;
  cleanup: () => Promise<void>;
}

export async function prepareCoreBrowserTarget(input: {
  environment: "LOCAL" | "BROWSERBASE";
  toolSurface: ToolSurface;
  startupProfile: StartupProfile;
}): Promise<PreparedCoreBrowserTarget> {
  const { startupProfile } = input;

  switch (startupProfile) {
    case "runner_provided_local_cdp": {
      const target = await launchRunnerProvidedLocalChrome();
      return {
        providedEndpoint: {
          kind: "ws",
          url: target.wsUrl,
        },
        cleanup: target.cleanup,
      };
    }
    case "runner_provided_browserbase_cdp":
      {
        const target = await launchRunnerProvidedBrowserbaseChrome();
        return {
          providedEndpoint: {
            kind: "ws",
            url: target.wsUrl,
          },
          metadata: {
            browserbaseSessionId: target.sessionId,
            browserbaseSessionUrl: target.sessionUrl,
            ...(target.debugUrl
              ? { browserbaseDebugUrl: target.debugUrl }
              : {}),
          },
          cleanup: target.cleanup,
        };
      }
    default:
      return {
        cleanup: async () => {},
      };
  }
}
