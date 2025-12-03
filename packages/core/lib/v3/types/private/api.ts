import Browserbase from "@browserbasehq/sdk";
import {
  Action,
  ActOptions,
  ExtractOptions,
  LogLine,
  ObserveOptions,
  V3Options,
} from "../public";
import type { Protocol } from "devtools-protocol";
import type { StagehandZodSchema } from "../../zodCompat";

export interface StagehandAPIConstructorParams {
  apiKey?: string;
  projectId?: string;
  baseUrl?: string;
  logger: (message: LogLine) => void;
}

export interface ExecuteActionParams {
  method: "act" | "extract" | "observe" | "navigate" | "end" | "agentExecute";
  args?: unknown;
  params?: unknown;
}

export interface StartSessionParams extends Partial<V3Options> {
  /**
   * Optional external session identifier.
   * When provided, StagehandServer will use this as the in-memory session id
   * instead of generating a new UUID. This allows cloud environments to align
   * library sessions with their own persisted session IDs (e.g. Browserbase).
   */
  sessionId?: string;
  modelName: string;
  modelApiKey: string;
  domSettleTimeoutMs: number;
  verbose: 0 | 1 | 2;
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
  schema?: StagehandZodSchema;
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
