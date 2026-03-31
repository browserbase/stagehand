import type { ToolSet } from "ai";
import type { V3 } from "../../../v3.js";
import { createAnthropicCuaTool } from "./anthropicCuaTool.js";

export async function createAnthropicCuaTools(v3: V3): Promise<ToolSet> {
  const computerTool = await createAnthropicCuaTool(v3);
  return {
    computer: computerTool,
  };
}
