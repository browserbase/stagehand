import { z } from "zod";
import type { InferStagehandSchema, StagehandZodSchema } from "../../zodCompat";
import { ModelConfiguration } from "../public/model";
import { AnyPage } from "./page";

export interface ActOptions {
  model?: ModelConfiguration;
  variables?: Record<string, string>;
  timeout?: number;
  page?: AnyPage;
}

export interface ActResult {
  success: boolean;
  message: string;
  actionDescription: string;
  actions: Action[];
}

export type ExtractResult<T extends StagehandZodSchema> =
  InferStagehandSchema<T>;

export interface Action {
  selector: string;
  description: string;
  method?: string;
  arguments?: string[];
}

export interface HistoryEntry {
  method: "act" | "extract" | "observe" | "navigate" | "agent";
  parameters: unknown;
  result: unknown;
  timestamp: string;
}

export interface ExtractOptions {
  model?: ModelConfiguration;
  timeout?: number;
  selector?: string;
  page?: AnyPage;
}

export const defaultExtractSchema = z.object({
  extraction: z.string(),
});

export const pageTextSchema = z.object({
  pageText: z.string(),
});

export interface ObserveOptions {
  model?: ModelConfiguration;
  timeout?: number;
  selector?: string;
  page?: AnyPage;
}

export enum V3FunctionName {
  ACT = "ACT",
  EXTRACT = "EXTRACT",
  OBSERVE = "OBSERVE",
  AGENT = "AGENT",
}
