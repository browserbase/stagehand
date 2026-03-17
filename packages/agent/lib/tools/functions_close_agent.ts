import { z } from "zod/v4";
import { CloseAgentArgsSchema } from "../protocol.js";
import { closeManagedAgent } from "../state/agents.js";
import type { ToolSpec } from "./types.js";

export const FUNCTIONS_CLOSE_AGENT_RESULT_SCHEMA = z.object({
  ok: z.boolean(),
  id: z.string(),
  status: z.enum(["closed", "not_found"]),
});

export const functions_close_agent = {
  name: "functions_close_agent",
  description: "Close a background agent created with functions_spawn_agent.",
  inputSchema: CloseAgentArgsSchema,
  outputSchema: FUNCTIONS_CLOSE_AGENT_RESULT_SCHEMA,
  execute: async (input, context) =>
    FUNCTIONS_CLOSE_AGENT_RESULT_SCHEMA.parse(
      await closeManagedAgent(context.workspace, input),
    ),
} satisfies ToolSpec;
