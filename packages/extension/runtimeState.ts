import { z } from "zod/v4";
import { StagehandInitParamsSchema } from "../protocol/schemas.js";

export const StagehandRuntimeStateSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("created") }),
  z.strictObject({
    status: z.literal("initialized"),
    initParams: StagehandInitParamsSchema,
  }),
  z.strictObject({ status: z.literal("closed") }),
]);

export type StagehandRuntimeState = z.infer<typeof StagehandRuntimeStateSchema>;
