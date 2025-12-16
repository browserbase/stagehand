import Browserbase from "@browserbasehq/sdk";
import {
  Action,
  ActOptions,
  ExtractOptions,
  LogLine,
  ObserveOptions,
} from "../public";
import type { StagehandZodSchema } from "../../zodCompat";
import type { LocalBrowserLaunchOptions } from "../public";

// Re-export schemas and types from the single source of truth
export {
  NavigateResponseDataSchema as navigateResponseSchema,
  type NavigateResponseData as NavigateResponse,
  type SessionStartResult as StartSessionResult,
} from "../../client/schemas";

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

/**
 * Parameters for starting a session via the API client.
 * Note: This extends the base schema with client-specific fields like modelApiKey.
 */
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
