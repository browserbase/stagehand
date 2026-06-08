import type { V3 } from "@browserbasehq/stagehand";
import type { EvalLogger } from "../logger.js";
import { StagehandV4BraintrustReporter } from "./StagehandV4BraintrustReporter.js";
import type { EventBusTraceSpan } from "./braintrust.js";

type V3FlowEvent = {
  data?: Record<string, unknown>;
  eventCreatedAt?: string;
  eventId?: string;
  eventParentIds?: string[];
  eventType?: string;
  sessionId?: string;
};

export function installStagehandV3FlowLoggerBraintrustReporting({
  braintrustReporter,
  category,
  logger,
  v3,
  verbose,
}: {
  braintrustReporter: StagehandV4BraintrustReporter;
  category: string;
  logger: EvalLogger;
  v3: V3;
  verbose?: boolean;
}): () => void {
  const listener = (event: unknown) => {
    const record = v3FlowEventToBraintrustTraceSpan(event);
    if (record == null) return;
    void braintrustReporter
      .handle(record)
      .then((loggedCount) => {
        if (loggedCount > 0 && verbose) {
          logger.log({
            category,
            message: `Logged ${loggedCount} new v3 flow span to Braintrust`,
            level: 1,
          });
        }
      })
      .catch((error) => {
        logger.warn({
          category,
          message: `Unable to report v3 flow span to Braintrust: ${
            error instanceof Error ? error.message : String(error)
          }`,
          level: 1,
        });
      });
  };
  v3.bus.on("*", listener);
  return () => {
    v3.bus.off("*", listener);
  };
}

function v3FlowEventToBraintrustTraceSpan(
  value: unknown,
): EventBusTraceSpan | null {
  if (!isRecord(value)) return null;
  const event = value as V3FlowEvent;
  if (
    typeof event.eventId !== "string" ||
    typeof event.eventType !== "string"
  ) {
    return null;
  }
  const data = isRecord(event.data) ? event.data : {};
  const eventType = normalizedFlowEventType(event.eventType);
  const method = typeof data.method === "string" ? data.method : undefined;
  const parentEventId = event.eventParentIds?.at(-1);
  const timestamp =
    typeof event.eventCreatedAt === "string"
      ? event.eventCreatedAt
      : new Date().toISOString();
  const startTime =
    typeof data.started_at === "string" ? data.started_at : timestamp;
  return {
    spanId: flowSpanId(event.eventId),
    ...(parentEventId == null
      ? {}
      : { parentSpanId: flowSpanId(parentEventId) }),
    name: `StagehandV3.emit(${method == null ? eventType : `${eventType}(${method})`})`,
    startTime,
    endTime: timestamp,
    attributes: v3FlowAttributes(eventType, event, data),
    ...(typeof data.result === "undefined" ? {} : { result: data.result }),
    ...(typeof data.error === "string" ? { error: data.error } : {}),
  };
}

function normalizedFlowEventType(eventType: string): string {
  if (eventType === "LlmRequestEvent") return "LLMRequestEvent";
  if (eventType === "LlmResponseEvent") return "LLMResponseEvent";
  return eventType;
}

function flowSpanId(eventId: string): string {
  return `v3-flow:${eventId}`;
}

function v3FlowAttributes(
  eventType: string,
  event: V3FlowEvent,
  data: Record<string, unknown>,
): Record<string, unknown> {
  if (eventType === "LLMRequestEvent") {
    return compactAttributes({
      request_id: data.requestId,
      llm_model_name: data.model,
      prompt: data.prompt,
      messages: data.messages,
      options: data.options,
      stagehand_session_id: event.sessionId,
    });
  }
  if (eventType === "LLMResponseEvent") {
    return compactAttributes({
      request_id: data.requestId,
      llm_model_name: data.model,
      output: data.output,
      raw: data.raw,
      tool_calls: data.tool_calls,
      usage: compactAttributes({
        input_tokens: data.inputTokens,
        output_tokens: data.outputTokens,
        prompt_tokens: data.inputTokens,
        completion_tokens: data.outputTokens,
        ...(isRecord(data.usage) ? data.usage : {}),
      }),
      stagehand_session_id: event.sessionId,
    });
  }
  return compactAttributes({
    ...data,
    stagehand_session_id: event.sessionId,
  });
}

function compactAttributes(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, unknown] =>
        entry[1] !== undefined && typeof entry[1] !== "function",
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}
