import { functions_close_agent } from "./functions_close_agent.js";
import { functions_exec_command } from "./functions_exec_command.js";
import { functions_spawn_agent } from "./functions_spawn_agent.js";
import { functions_update_plan } from "./functions_update_plan.js";
import { functions_view_image_or_document } from "./functions_view_image_or_document.js";
import { functions_wait } from "./functions_wait.js";
import { functions_write_stdin } from "./functions_write_stdin.js";
import { multi_tool_use_parallel } from "./multi_tool_use_parallel.js";
import type { ToolMap } from "./types.js";

export type { AgentToolContext, ToolMap, ToolSpec } from "./types.js";

export const ALL_TOOLS = {
  functions_exec_command,
  functions_write_stdin,
  functions_update_plan,
  functions_view_image_or_document,
  functions_wait,
  functions_spawn_agent,
  functions_close_agent,
  multi_tool_use_parallel,
} satisfies ToolMap;
