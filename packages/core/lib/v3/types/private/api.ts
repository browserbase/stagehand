import Browserbase from "@browserbasehq/sdk";
import { ZodTypeAny } from "zod/v3";
import {
  Action,
  ActOptions,
  ExtractOptions,
  LogLine,
  ObserveOptions,
} from "../public";
import type { Protocol } from "devtools-protocol";

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
}

export interface StartSessionResult {
  sessionId: string;
  available?: boolean;
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
  schema?: ZodTypeAny;
  options?: ExtractOptions;
  frameId?: string;
}

export interface APIObserveParameters {
  instruction?: string;
  options?: ObserveOptions;
  frameId?: string;
}

export interface SerializableResponse {
  requestId: string;
  frameId?: string;
  loaderId?: string;
  response: Protocol.Network.Response;
  fromServiceWorkerFlag?: boolean;
  finishedSettled?: boolean;
  extraInfoHeaders?: Protocol.Network.Headers | null;
  extraInfoHeadersText?: string;
}
