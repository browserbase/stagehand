import type { CoreTool, ToolSurface } from "../contracts/tool.js";
import { BrowseCliTool } from "./browse_cli.js";
import { CdpCodeTool } from "./cdp_code.js";
import { ChromeDevtoolsMcpTool } from "./chrome_devtools_mcp.js";
import { PlaywrightCodeTool } from "./playwright_code.js";
import { PlaywrightMcpTool } from "./playwright_mcp.js";
import { StagehandCodeTool } from "./stagehand_code.js";
import { StagehandFacadeTool } from "./stagehand_facade.js";
import { UnderstudyCodeTool } from "./understudy_code.js";

/** Surfaces that exist only as an agent MCP mount; they have no runner-driven CoreSession (activePage() throws). */
export const AGENT_MOUNT_ONLY_TOOL_SURFACES: ReadonlySet<ToolSurface> = new Set<ToolSurface>([
  "stagehand_facade",
]);

export function isAgentMountOnlyToolSurface(toolSurface: ToolSurface): boolean {
  return AGENT_MOUNT_ONLY_TOOL_SURFACES.has(toolSurface);
}

export function listCoreTools(): ToolSurface[] {
  return [
    "understudy_code",
    "stagehand_code",
    "playwright_code",
    "cdp_code",
    "playwright_mcp",
    "chrome_devtools_mcp",
    // Listed here as part of the full enumeration, but agent-mount-only:
    // core-tier selection must use listCoreRunnableTools, which filters it.
    "stagehand_facade",
    "browse_cli",
  ];
}

/** Tool surfaces `evals core` can drive directly (listCoreTools minus agent-mount-only surfaces). */
export function listCoreRunnableTools(): ToolSurface[] {
  return listCoreTools().filter((toolSurface) => !isAgentMountOnlyToolSurface(toolSurface));
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
