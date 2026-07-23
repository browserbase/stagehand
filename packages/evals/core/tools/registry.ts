import type { CoreTool, ToolSurface } from "../contracts/tool.js";
import { BrowseCliTool } from "./browse_cli.js";
import { CdpCodeTool } from "./cdp_code.js";
import { ChromeDevtoolsMcpTool } from "./chrome_devtools_mcp.js";
import { PlaywrightCodeTool } from "./playwright_code.js";
import { PlaywrightMcpTool } from "./playwright_mcp.js";
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
    case "cdp_code":
      return new CdpCodeTool();
    case "playwright_mcp":
      return new PlaywrightMcpTool();
    case "chrome_devtools_mcp":
      return new ChromeDevtoolsMcpTool();
    case "browse_cli":
      return new BrowseCliTool();
    default:
      throw new Error(`Tool surface "${toolSurface}" is not implemented yet`);
  }
}
