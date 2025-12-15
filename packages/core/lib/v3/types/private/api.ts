import Browserbase from "@browserbasehq/sdk";
import { z } from "zod";
import {
  Action,
  ActOptions,
  ExtractOptions,
  LogLine,
  ObserveOptions,
} from "../public";
import type { StagehandZodSchema } from "../../zodCompat";
import type { LocalBrowserLaunchOptions } from "../public";

export interface StagehandAPIConstructorParams {
  apiKey: string;
  projectId: string;
  logger: (message: LogLine) => void;
}

export interface ExecuteActionParams {
  method: "act" | "extract" | "observe" | "navigate" | "end" | "agentExecute";
  args?: unknown;
  params?: unknown;
}

export interface StartSessionParams {
  modelName: string;
  modelApiKey: string;
  domSettleTimeoutMs: number;
  verbose: number;
  systemPrompt?: string;
  browserbaseSessionCreateParams?: Omit<
    Browserbase.Sessions.SessionCreateParams,
    "projectId"
  > & { projectId?: string };
  selfHeal?: boolean;
  browserbaseSessionID?: string;
  browser?: {
    type?: "local" | "browserbase";
    cdpUrl?: string;
    launchOptions?: LocalBrowserLaunchOptions;
  };
}

export interface StartSessionResult {
  sessionId: string;
  available?: boolean;
  cdpUrl: string;
}

export interface SuccessResponse<T> {
  success: true;
  data: T;
}

export interface ErrorResponse {
  success: false;
  message: string;
}

export type ApiResponse<T> = SuccessResponse<T> | ErrorResponse;

export interface APIActParameters {
  input: string | Action;
  options?: ActOptions;
  frameId?: string;
}

export interface APIExtractParameters {
  instruction?: string;
  schema?: StagehandZodSchema;
  options?: ExtractOptions;
  frameId?: string;
}

export interface APIObserveParameters {
  instruction?: string;
  options?: ObserveOptions;
  frameId?: string;
}

export const navigateResponseSchema = z
  .object({
    requestId: z.string(),
    frameId: z.string().optional(),
    loaderId: z.string().optional(),
    response: z.unknown(),
    fromServiceWorkerFlag: z.boolean().optional(),
    finishedSettled: z.boolean().optional(),
    extraInfoHeaders: z.record(z.string(), z.string()).nullish(),
    extraInfoHeadersText: z.string().optional(),
  })
  .strict();

export type NavigateResponse = z.infer<typeof navigateResponseSchema>;
