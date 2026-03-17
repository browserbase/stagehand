import { z } from "zod/v4";
import { SpawnExtraAgentArgsSchema } from "../protocol.js";
import { spawnManagedAgent } from "../state/agents.js";
import type { ToolSpec } from "./types.js";

export const FUNCTIONS_SPAWN_AGENT_RESULT_SCHEMA = z.object({
  ok: z.boolean(),
  id: z.string(),
  status: z.string(),
});

export const functions_spawn_agent = {
  name: "functions_spawn_agent",
  description:
    "Create a background extra subagent that runs inside browse subagent with its own browser session.",
  inputSchema: SpawnExtraAgentArgsSchema,
  outputSchema: FUNCTIONS_SPAWN_AGENT_RESULT_SCHEMA,
  execute: async (input, context) =>
    FUNCTIONS_SPAWN_AGENT_RESULT_SCHEMA.parse(
      await spawnManagedAgent(context.workspace, input),
    ),
} satisfies ToolSpec;
