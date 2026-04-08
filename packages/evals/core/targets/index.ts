import type { StartupProfile, ToolSurface } from "../contracts/tool.js";
import { launchRunnerProvidedLocalChrome } from "./localChrome.js";

export interface PreparedCoreBrowserTarget {
  providedEndpoint?: {
    kind: "ws" | "http";
    url: string;
    headers?: Record<string, string>;
  };
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
      throw new Error(
        `Runner-provided Browserbase CDP is not implemented yet for "${input.toolSurface}"`,
      );
    default:
      return {
        cleanup: async () => {},
      };
  }
}
