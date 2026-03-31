import type { ToolSet } from "ai";
import type { V3 } from "../../../v3.js";
import { createAnthropicCuaTool } from "./anthropicCuaTool.js";

export function createAnthropicCuaTools(v3: V3): ToolSet {
  return {
    computer: createAnthropicCuaTool(v3),
  };
}
