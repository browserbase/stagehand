import type { CoreTool, ToolSurface } from "../contracts/tool.js";
import { BrowseCliTool } from "./browse_cli.js";
import { CdpCodeTool } from "./cdp_code.js";
import { ChromeDevtoolsMcpTool } from "./chrome_devtools_mcp.js";
import { PlaywrightCodeTool } from "./playwright_code.js";
import { PlaywrightMcpTool } from "./playwright_mcp.js";
import { StagehandCodeTool } from "./stagehand_code.js";
import { StagehandFacadeTool } from "./stagehand_facade.js";
import { UnderstudyCodeTool } from "./understudy_code.js";

export function listCoreTools(): ToolSurface[] {
  return [
    "understudy_code",
    "stagehand_code",
    "playwright_code",
    "cdp_code",
    "playwright_mcp",
    "chrome_devtools_mcp",
    // stagehand_facade is intentionally absent: it is resolvable via
    // getCoreTool for agent harness mounts, but its CoreSession cannot serve
    // core-tier runs (every page operation throws), so it must not be
    // selectable as a core tool.
    "browse_cli",
  ];
}

export function getCoreTool(toolSurface: ToolSurface): CoreTool {
  switch (toolSurface) {
    case "understudy_code":
      return new UnderstudyCodeTool();
    case "stagehand_code":
      return new StagehandCodeTool();
    case "playwright_code":
      return new PlaywrightCodeTool();
    case "cdp_code":
      return new CdpCodeTool();
    case "playwright_mcp":
      return new PlaywrightMcpTool();
    case "chrome_devtools_mcp":
      return new ChromeDevtoolsMcpTool();
    case "stagehand_facade":
      return new StagehandFacadeTool();
    case "browse_cli":
      return new BrowseCliTool();
    default:
      throw new Error(`Tool surface "${toolSurface}" is not implemented yet`);
  }
}
