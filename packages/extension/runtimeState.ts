import { z } from "zod/v4";
import { StagehandInitParamsSchema } from "../protocol/schemas.js";

export const StagehandRuntimeStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("idle") }),
  z.strictObject({
    status: z.literal("initialized"),
    initParams: StagehandInitParamsSchema,
  }),
]);

export type StagehandRuntimeState = z.infer<typeof StagehandRuntimeStateSchema>;
