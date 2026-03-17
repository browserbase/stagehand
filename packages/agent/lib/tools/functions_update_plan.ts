import { z } from "zod/v4";
import {
  PlanItemSchema,
  UpdatePlanArgsSchema,
} from "../protocol.js";
import { writePlanState } from "../state/session.js";
import type { ToolSpec } from "./types.js";

export const FUNCTIONS_UPDATE_PLAN_RESULT_SCHEMA = z.object({
  ok: z.literal(true),
  explanation: z.string().nullable(),
  plan: z.array(PlanItemSchema),
});

export const functions_update_plan = {
  name: "functions_update_plan",
  description: "Store a lightweight execution plan in the local runtime.",
  inputSchema: UpdatePlanArgsSchema,
  outputSchema: FUNCTIONS_UPDATE_PLAN_RESULT_SCHEMA,
  execute: async (input, context) =>
    FUNCTIONS_UPDATE_PLAN_RESULT_SCHEMA.parse(
      {
        ok: true,
        explanation: input.explanation ?? null,
        plan: (await writePlanState(context.workspace, input)).plan,
      },
    ),
} satisfies ToolSpec;
