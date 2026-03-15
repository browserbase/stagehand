import type { StdioLaunchConfig } from "../../types.js";
import { resolvePackageBin } from "../../utils/process.js";
import type { MCPServerAdapter, MCPServerAdapterContext } from "./base.js";

export class ChromeDevtoolsMCPAdapter implements MCPServerAdapter {
  readonly type = "chrome-devtools" as const;

  async getLaunchConfig(
    context: MCPServerAdapterContext,
  ): Promise<StdioLaunchConfig> {
    const entry = resolvePackageBin("chrome-devtools-mcp", "chrome-devtools-mcp");
    const args = [entry, "--no-usage-statistics"];
    const browserUrl = context.browserSession?.getBrowserUrl();

    if (browserUrl) {
      args.push(`--browser-url=${browserUrl}`);
    } else if (context.options.browser?.headless ?? true) {
      args.push("--headless=true");
      args.push("--isolated=true");
    }

    if (context.options.browser?.viewport) {
      args.push(
        "--viewport",
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
