import { z } from "zod/v4";
import { WaitArgsSchema } from "../protocol.js";
import { waitForManagedAgents } from "../state/agents.js";
import type { ToolSpec } from "./types.js";

export const FUNCTIONS_WAIT_RESULT_SCHEMA = z.object({
  ok: z.boolean(),
  completed: z.boolean(),
  timeout_ms: z.number().int().nonnegative().optional(),
  message: z.string().nullable().optional(),
  results: z.array(
    z.object({
      id: z.string(),
      status: z.enum(["running", "completed", "failed", "closed", "unknown"]),
      output: z.unknown().optional(),
      error: z.string().optional(),
    }),
  ),
});

export const functions_wait = {
  name: "functions_wait",
  description:
    "Wait for long-lived runtime task ids such as dynamically spawned background agents.",
  inputSchema: WaitArgsSchema,
  outputSchema: FUNCTIONS_WAIT_RESULT_SCHEMA,
  execute: async (input, context) =>
    FUNCTIONS_WAIT_RESULT_SCHEMA.parse(
      await waitForManagedAgents(context.workspace, input),
    ),
} satisfies ToolSpec;
