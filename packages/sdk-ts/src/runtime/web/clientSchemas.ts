import { z } from "zod/v4";
import {
  BrowserbaseBrowserSourceSchema,
  CdpBrowserSourceSchema,
  createStagehandClientInitParamsSchema,
} from "../../clientSchemas.shared.js";

export const BrowserSourceSchema = z
  .discriminatedUnion("type", [BrowserbaseBrowserSourceSchema, CdpBrowserSourceSchema])
  .meta({ id: "BrowserSource" });

export const StagehandClientInitParamsSchema =
  createStagehandClientInitParamsSchema(BrowserSourceSchema);

export type BrowserSource = z.infer<typeof BrowserSourceSchema>;
export type StagehandClientInitParams = z.input<typeof StagehandClientInitParamsSchema>;
export type ResolvedStagehandClientInitParams = z.output<typeof StagehandClientInitParamsSchema>;
