import type { CoreTool, ToolSurface } from "../contracts/tool.js";
import { PlaywrightCodeTool } from "./playwright_code.js";
import { UnderstudyCodeTool } from "./understudy_code.js";

export function listCoreTools(): ToolSurface[] {
  return [
    "understudy_code",
    "playwright_code",
    "cdp_code",
    "playwright_mcp",
    "chrome_devtools_mcp",
    "browse_cli",
  ];
}

export function getCoreTool(toolSurface: ToolSurface): CoreTool {
  switch (toolSurface) {
    case "understudy_code":
      return new UnderstudyCodeTool();
    case "playwright_code":
      return new PlaywrightCodeTool();
    default:
      throw new Error(
        `Tool surface "${toolSurface}" is not implemented yet`,
      );
  }
}
