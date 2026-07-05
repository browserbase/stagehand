import {
  appendSummary,
  writeTimestampedTxtFile,
} from "../../../inferenceLogUtils.js";

const AGENT_SUMMARY_DIR = "agent_summary";

export interface AgentInferenceUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  reasoning_tokens?: number;
  cached_input_tokens?: number;
  inference_time_ms?: number;
}

export interface AgentStepCallRecord {
  fileName: string;
  timestamp: string;
  startedAtMs: number;
}

function dataToKb(data: string): string {
  return ((data.length * 0.75) / 1024).toFixed(1);
}

type SanitizeContext = {
  parentKey?: string;
};

function isImageKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    normalized.includes("image") ||
    normalized.includes("screenshot") ||
    normalized === "base64" ||
    normalized === "inline_data" ||
    normalized === "imagedata" ||
    normalized === "image_url"
  );
}

function isLikelyBase64Image(value: string): boolean {
  if (value.startsWith("data:image/")) return true;
  if (value.length < 1024) return false;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(value.slice(0, 512))) return false;
  return value.length >= 4096;
}

function omitImagePayload(value: string): string {
  return `[image omitted, ${dataToKb(value)}kb]`;
}

function shouldOmitString(value: string, key: string): boolean {
  if (isImageKey(key)) return true;
  if (key.toLowerCase() === "data" && isLikelyBase64Image(value)) return true;
  return isLikelyBase64Image(value);
}

function sanitizeUnknownObject(value: object): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    return `[binary omitted, ${dataToKb(value.toString("base64"))}kb]`;
  }
  if (ArrayBuffer.isView(value)) {
    return `[binary omitted, ${value.byteLength} bytes]`;
  }

  try {
    return sanitizeForInferenceLog(JSON.parse(JSON.stringify(value)));
  } catch {
    return `[object omitted, ${value.constructor?.name ?? "Object"}]`;
  }
}

/**
 * Deep-clone and redact large binary/image payloads before writing inference logs.
 *
 * Complements `redactInlineImagePayloads` in evidenceNormalization.ts, which
 * targets verifier/evidence output with a fixed key list. This helper is tuned
 * for inference file dumps: heuristic base64 detection and size markers.
 */
export function sanitizeForInferenceLog(
  data: unknown,
  context: SanitizeContext = {},
): unknown {
  if (data === null || data === undefined) return data;

  if (typeof data === "string") {
    const key = context.parentKey ?? "";
    if (shouldOmitString(data, key)) {
      return omitImagePayload(data);
    }
    return data;
  }

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeForInferenceLog(item, context));
  }

  if (typeof data === "object") {
    const proto = Object.getPrototypeOf(data);
    if (proto !== Object.prototype && proto !== null) {
      return sanitizeUnknownObject(data);
    }

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      data as Record<string, unknown>,
    )) {
      if (
        key === "type" &&
        typeof value === "string" &&
        (value === "image" || value === "input_image" || value === "image_url")
      ) {
        out[key] = value;
        continue;
      }
      out[key] = sanitizeForInferenceLog(value, { parentKey: key });
    }
    return out;
  }

  return data;
}

function tryWriteAgentFile(
  prefix: string,
  payload: unknown,
): { fileName: string; timestamp: string } | null {
  try {
    return writeTimestampedTxtFile(
      AGENT_SUMMARY_DIR,
      prefix,
      sanitizeForInferenceLog(payload),
    );
  } catch {
    return null;
  }
}

function tryAppendSummary(entry: Record<string, unknown>): void {
  try {
    appendSummary("agent", entry);
  } catch {
    // Inference logging must never fail the agent run.
  }
}

export function logAgentRunStart(opts: {
  instruction: string;
  mode?: string;
  modelId: string;
  tools: string[];
  agentType?: "dom" | "cua";
}): void {
  tryWriteAgentFile("agent_run_start", {
    modelCall: "agent",
    agentType: opts.agentType ?? "dom",
    instruction: opts.instruction,
    mode: opts.mode,
    modelId: opts.modelId,
    tools: opts.tools,
  });
}

export function logAgentStepCall(opts: {
  stepIndex: number;
  payload: unknown;
}): AgentStepCallRecord | null {
  const written = tryWriteAgentFile(`agent_step_${opts.stepIndex}_call`, {
    modelCall: "agent",
    step: opts.stepIndex,
    ...((typeof opts.payload === "object" && opts.payload !== null
      ? opts.payload
      : { payload: opts.payload }) as Record<string, unknown>),
  });
  if (!written) return null;

  return {
    fileName: written.fileName,
    timestamp: written.timestamp,
    startedAtMs: Date.now(),
  };
}

export function logAgentStepResponse(opts: {
  stepIndex: number;
  payload: unknown;
}): { fileName: string; timestamp: string } | null {
  return tryWriteAgentFile(`agent_step_${opts.stepIndex}_response`, {
    modelResponse: "agent",
    step: opts.stepIndex,
    ...((typeof opts.payload === "object" && opts.payload !== null
      ? opts.payload
      : { payload: opts.payload }) as Record<string, unknown>),
  });
}

export function logAgentStepSummary(opts: {
  stepIndex: number;
  callFile: string;
  responseFile: string;
  timestamp: string;
  usage?: AgentInferenceUsage;
  agentInferenceType?: string;
  status?: "completed" | "failed";
  error?: string;
}): void {
  tryAppendSummary({
    agent_inference_type: opts.agentInferenceType ?? "agent_step",
    step: opts.stepIndex,
    timestamp: opts.timestamp,
    LLM_input_file: opts.callFile,
    LLM_output_file: opts.responseFile,
    status: opts.status ?? "completed",
    ...(opts.error ? { error: opts.error } : {}),
    prompt_tokens: opts.usage?.prompt_tokens ?? 0,
    completion_tokens: opts.usage?.completion_tokens ?? 0,
    reasoning_tokens: opts.usage?.reasoning_tokens ?? 0,
    cached_input_tokens: opts.usage?.cached_input_tokens ?? 0,
    inference_time_ms: opts.usage?.inference_time_ms ?? 0,
  });
}

export function completeAgentStepInference(opts: {
  stepIndex: number;
  call: AgentStepCallRecord;
  responsePayload: unknown;
  usage?: AgentInferenceUsage;
  agentInferenceType?: string;
}): void {
  const response = logAgentStepResponse({
    stepIndex: opts.stepIndex,
    payload: opts.responsePayload,
  });
  if (!response) return;

  logAgentStepSummary({
    stepIndex: opts.stepIndex,
    callFile: opts.call.fileName,
    responseFile: response.fileName,
    timestamp: opts.call.timestamp,
    usage: {
      ...opts.usage,
      inference_time_ms:
        opts.usage?.inference_time_ms ??
        Math.max(0, Date.now() - opts.call.startedAtMs),
    },
    agentInferenceType: opts.agentInferenceType,
  });
}

export function failAgentStepInference(opts: {
  stepIndex: number;
  call: AgentStepCallRecord;
  error: unknown;
  agentInferenceType?: string;
}): void {
  const message =
    opts.error instanceof Error ? opts.error.message : String(opts.error);
  const response = logAgentStepResponse({
    stepIndex: opts.stepIndex,
    payload: {
      status: "failed",
      error: message,
    },
  });
  if (!response) return;

  logAgentStepSummary({
    stepIndex: opts.stepIndex,
    callFile: opts.call.fileName,
    responseFile: response.fileName,
    timestamp: opts.call.timestamp,
    agentInferenceType: opts.agentInferenceType,
    status: "failed",
    error: message,
    usage: {
      inference_time_ms: Math.max(0, Date.now() - opts.call.startedAtMs),
    },
  });
}

export function finalizePendingAgentSteps(
  pendingCalls: Map<number, AgentStepCallRecord>,
  reason: string,
  agentInferenceType = "agent_step",
): void {
  for (const [stepIndex, call] of pendingCalls.entries()) {
    failAgentStepInference({
      stepIndex,
      call,
      error: reason,
      agentInferenceType,
    });
  }
  pendingCalls.clear();
}

export function logAgentDoneInference(opts: {
  callPayload: unknown;
  responsePayload: unknown;
  usage?: AgentInferenceUsage;
}): void {
  const call = tryWriteAgentFile("agent_done_call", {
    modelCall: "agent_done",
    ...(typeof opts.callPayload === "object" && opts.callPayload !== null
      ? opts.callPayload
      : { payload: opts.callPayload }),
  });
  if (!call) return;

  const response = tryWriteAgentFile("agent_done_response", {
    modelResponse: "agent_done",
    ...(typeof opts.responsePayload === "object" &&
    opts.responsePayload !== null
      ? opts.responsePayload
      : { payload: opts.responsePayload }),
  });
  if (!response) return;

  tryAppendSummary({
    agent_inference_type: "agent_done",
    timestamp: call.timestamp,
    LLM_input_file: call.fileName,
    LLM_output_file: response.fileName,
    status: "completed",
    prompt_tokens: opts.usage?.prompt_tokens ?? 0,
    completion_tokens: opts.usage?.completion_tokens ?? 0,
    reasoning_tokens: opts.usage?.reasoning_tokens ?? 0,
    cached_input_tokens: opts.usage?.cached_input_tokens ?? 0,
    inference_time_ms: opts.usage?.inference_time_ms ?? 0,
  });
}

export function mapAiSdkStepUsage(
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
  },
  inferenceTimeMs?: number,
): AgentInferenceUsage {
  return {
    prompt_tokens: usage?.inputTokens ?? 0,
    completion_tokens: usage?.outputTokens ?? 0,
    reasoning_tokens: usage?.reasoningTokens ?? 0,
    cached_input_tokens: usage?.cachedInputTokens ?? 0,
    inference_time_ms: inferenceTimeMs,
  };
}

export function mapCuaStepUsage(usage?: {
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  cached_input_tokens?: number;
  inference_time_ms?: number;
}): AgentInferenceUsage {
  return {
    prompt_tokens: usage?.input_tokens ?? 0,
    completion_tokens: usage?.output_tokens ?? 0,
    reasoning_tokens: usage?.reasoning_tokens ?? 0,
    cached_input_tokens: usage?.cached_input_tokens ?? 0,
    inference_time_ms: usage?.inference_time_ms,
  };
}

export type CuaStepInferenceContext = {
  logCall: (payload: unknown) => void;
};

export interface CuaStepInferenceResult {
  actions: unknown[];
  message?: string;
  completed: boolean;
  responseId?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    reasoning_tokens?: number;
    cached_input_tokens?: number;
    inference_time_ms?: number;
  };
}

/**
 * Runs a CUA executeStep with optional per-step inference file logging.
 */
export async function runCuaStepWithInferenceLogging<
  T extends CuaStepInferenceResult,
>(opts: {
  logInferenceToFile: boolean;
  stepIndex: number;
  modelId: string;
  callPayload?: unknown;
  executeStep: (ctx?: CuaStepInferenceContext) => Promise<T>;
  mapResponse?: (result: T) => Record<string, unknown>;
}): Promise<T> {
  let pendingCall: AgentStepCallRecord | null = null;

  const logCall = (payload: unknown) => {
    if (!opts.logInferenceToFile || pendingCall) return;
    pendingCall = logAgentStepCall({
      stepIndex: opts.stepIndex,
      payload: {
        modelId: opts.modelId,
        request: payload,
      },
    });
  };

  if (opts.logInferenceToFile && opts.callPayload !== undefined) {
    logCall(opts.callPayload);
  }

  const ctx = opts.logInferenceToFile ? { logCall } : undefined;

  try {
    const result = await opts.executeStep(ctx);

    if (pendingCall) {
      const response = opts.mapResponse
        ? opts.mapResponse(result)
        : {
            actions: result.actions,
            message: result.message,
            completed: result.completed,
            ...(result.responseId ? { responseId: result.responseId } : {}),
          };

      completeAgentStepInference({
        stepIndex: opts.stepIndex,
        call: pendingCall,
        responsePayload: {
          modelId: opts.modelId,
          response,
        },
        usage: mapCuaStepUsage(result.usage),
        agentInferenceType: "agent_cua_step",
      });
    }

    return result;
  } catch (error) {
    if (pendingCall) {
      failAgentStepInference({
        stepIndex: opts.stepIndex,
        call: pendingCall,
        error,
        agentInferenceType: "agent_cua_step",
      });
    }
    throw error;
  }
}
