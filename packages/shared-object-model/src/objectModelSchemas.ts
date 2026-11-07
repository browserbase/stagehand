/**
 * Operation schemas shared by the SDK object model and extension callback batches. They extend
 * wire schemas with local Page and Locator instances and client-facing option defaults.
 */

import { z } from "zod/v4";
import * as ProtocolSchemas from "@browserbasehq/stagehand-protocol/schemas";
import {
  ActOptionsSchema,
  ExtractOptionsSchema,
  ObserveOptionsSchema,
} from "@browserbasehq/stagehand-protocol/schemas";
import { Page } from "./page.js";
import { Locator } from "./locator.js";

export const StagehandClientActOptionsSchema = ActOptionsSchema.extend({
  locator: z.instanceof(Locator).optional(),
  ignoreLocators: z.array(z.instanceof(Locator)).optional(),
  page: z.instanceof(Page).optional(),
}).meta({ id: "StagehandClientActOptions" });

export const StagehandClientObserveOptionsSchema = ObserveOptionsSchema.extend({
  locator: z.instanceof(Locator).optional(),
  ignoreLocators: z.array(z.instanceof(Locator)).optional(),
  page: z.instanceof(Page).optional(),
}).meta({ id: "StagehandClientObserveOptions" });

export const StagehandClientExtractOptionsSchema = ExtractOptionsSchema.extend({
  locator: z.instanceof(Locator).optional(),
  ignoreLocators: z.array(z.instanceof(Locator)).optional(),
  page: z.instanceof(Page).optional(),
}).meta({ id: "StagehandClientExtractOptions" });

export const WebMCPToolsOptionsSchema = ProtocolSchemas.WebMCPToolsOptionsSchema.partial();

export const WebMCPInvokeOptionsSchema = ProtocolSchemas.WebMCPInvokeOptionsSchema.partial();

export const WebMCPResultOptionsSchema = ProtocolSchemas.WebMCPResultOptionsSchema;

export type StagehandClientActOptions = z.input<typeof StagehandClientActOptionsSchema>;
export type StagehandClientObserveOptions = z.input<typeof StagehandClientObserveOptionsSchema>;
export type StagehandClientExtractOptions = z.input<typeof StagehandClientExtractOptionsSchema>;
export type WebMCPToolsOptions = z.infer<typeof WebMCPToolsOptionsSchema>;
export type WebMCPInvokeOptions = z.infer<typeof WebMCPInvokeOptionsSchema>;
export type WebMCPResultOptions = z.infer<typeof WebMCPResultOptionsSchema>;
