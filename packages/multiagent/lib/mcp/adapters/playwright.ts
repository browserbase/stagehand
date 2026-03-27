import type { StdioLaunchConfig } from "../../types.js";
import { resolvePackageBin } from "../../utils/process.js";
import type { MCPServerAdapter, MCPServerAdapterContext } from "./base.js";

export class PlaywrightMCPAdapter implements MCPServerAdapter {
  readonly type = "playwright" as const;

  async getLaunchConfig(
    context: MCPServerAdapterContext,
  ): Promise<StdioLaunchConfig> {
    const entry = resolvePackageBin("@playwright/mcp", "playwright-mcp");
    const args = [entry];
    const cdpUrl = context.browserSession?.getCdpUrl();

    if (cdpUrl) {
      args.push("--cdp-endpoint", cdpUrl);
    } else if (context.options.browser?.headless ?? true) {
      args.push("--headless");
    }

    if (context.options.browser?.viewport) {
      args.push(
        "--viewport-size",
        `${context.options.browser.viewport.width}x${context.options.browser.viewport.height}`,
      );
    }

    if (context.options.args?.length) {
      args.push(...context.options.args);
    }

    return {
      command: process.execPath,
      args,
      env: context.options.env,
    };
  }
}
