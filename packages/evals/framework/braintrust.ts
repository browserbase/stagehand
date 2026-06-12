import type {
  ExperimentLogPartialArgs,
  Span as BraintrustSpan,
} from "braintrust";

let braintrustPromise: Promise<typeof import("braintrust")> | undefined;

export type EventBusTraceSpan = {
  spanId: string;
  parentSpanId?: string;
  name: string;
  startTime?: string;
  endTime?: string;
  attributes?: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

type BraintrustTraceSpanInput = {
  braintrustName?: string;
  braintrustType?: "llm" | "tool";
  input?: unknown;
  output?: unknown;
  metadata?: Record<string, unknown>;
  metrics?: Record<string, number>;
};

type LLMTraceToolCall = {
  id?: string;
  llm_session_id?: string;
  name: string;
  request_id?: string;
};

export type BraintrustTraceToolDefinition = Record<string, unknown> & {
  description?: string;
  event_type?: string;
  name?: string;
};

export type BraintrustTraceReporter = {
  childRecordsByParentId: Map<string, EventBusTraceSpan[]>;
  handledRecordIds: Set<string>;
  llmRequestByRequestId: Map<string, EventBusTraceSpan>;
  llmResponseByRequestId: Map<string, EventBusTraceSpan>;
  pendingToolCallsByScopeId: Map<string, LLMTraceToolCall[]>;
  parent?: BraintrustSpan;
  recordsById: Map<string, EventBusTraceSpan>;
  spansById: Map<string, BraintrustSpan>;
  toolDefinitionByEventType: Map<string, BraintrustTraceToolDefinition>;
};

type BraintrustTraceContext = BraintrustTraceReporter & {
  loggedCount: number;
  parent: BraintrustSpan;
};

type BraintrustTraceMapping = {
  pattern: (record: EventBusTraceSpan, ctx: BraintrustTraceContext) => boolean;
  handle: (
    record: EventBusTraceSpan,
    ctx: BraintrustTraceContext,
  ) => Promise<boolean>;
};

const LLM_TRACE_PROVIDER_REQUEST_EVENT_TYPES = new Set([
  "OpenAILLMRequestEvent",
  "AnthropicLLMRequestEvent",
  "GoogleLLMRequestEvent",
  "NoopLLMRequestEvent",
  "LLMCustomClientRequestEvent",
]);

const LLM_TRACE_INTERNAL_EVENT_TYPES = new Set([
  "AgentToolCallEvent",
  "LLMRequestEvent",
  "LLMResponseEvent",
  "LLMErrorEvent",
  ...LLM_TRACE_PROVIDER_REQUEST_EVENT_TYPES,
]);

export function hasBraintrustApiKey(): boolean {
  return Boolean(process.env.BRAINTRUST_API_KEY);
}

export function loadBraintrust(): Promise<typeof import("braintrust")> {
  braintrustPromise ??= import("braintrust");
  return braintrustPromise;
}

export function createBraintrustTraceReporter(
  toolCatalog: BraintrustTraceToolDefinition[] = [],
): BraintrustTraceReporter {
  return {
    childRecordsByParentId: new Map(),
    handledRecordIds: new Set(),
    llmRequestByRequestId: new Map(),
    llmResponseByRequestId: new Map(),
    pendingToolCallsByScopeId: new Map(),
    recordsById: new Map(),
    spansById: new Map(),
    toolDefinitionByEventType: new Map(
      toolCatalog.flatMap((definition) =>
        typeof definition.event_type === "string"
          ? [[definition.event_type, definition]]
          : [],
      ),
    ),
  };
}

export async function tracedSpan<T>(
  fn: () => Promise<T>,
  options: { name: string },
): Promise<T> {
  if (!hasBraintrustApiKey()) {
    return fn();
  }
  const { traced } = await loadBraintrust();
  return traced(fn, options);
}

export async function logBraintrustTraceSpans(
  records: EventBusTraceSpan[],
  reporter: BraintrustTraceReporter = createBraintrustTraceReporter(),
): Promise<number> {
  if (!hasBraintrustApiKey()) {
    return 0;
  }

  const { currentSpan, NOOP_SPAN } = await loadBraintrust();
  const parent = reporter.parent ?? currentSpan();
  if (parent === NOOP_SPAN) {
    return 0;
  }
  reporter.parent = parent;

  const ctx = createBraintrustTraceContext(records, reporter, parent);
  for (const record of records) {
    if (ctx.handledRecordIds.has(record.spanId)) {
      await updateLoggedTraceSpan(record, ctx);
      continue;
    }
    const filterAction = busTraceFilterAction(
      record,
      ctx.childRecordsByParentId,
    );
    if (filterAction === "handled") {
      ctx.handledRecordIds.add(record.spanId);
      continue;
    }
    if (filterAction === "defer") {
      continue;
    }
    const mapping = BRAINTRUST_TRACE_MAPPINGS.find(({ pattern }) =>
      pattern(record, ctx),
    );
    const handled = (await mapping?.handle(record, ctx)) ?? false;
    if (handled) ctx.handledRecordIds.add(record.spanId);
  }
  return ctx.loggedCount;
}

function createBraintrustTraceContext(
  records: EventBusTraceSpan[],
  reporter: BraintrustTraceReporter,
  parent: BraintrustSpan,
): BraintrustTraceContext {
  for (const record of records) {
    reporter.recordsById.set(record.spanId, record);
  }
  reporter.childRecordsByParentId.clear();
  for (const record of reporter.recordsById.values()) {
    if (record.parentSpanId == null) continue;
    const children =
      reporter.childRecordsByParentId.get(record.parentSpanId) ?? [];
    children.push(record);
    reporter.childRecordsByParentId.set(record.parentSpanId, children);
  }

  return {
    ...reporter,
    loggedCount: 0,
    parent,
  };
}

const BUS_TRACE_FILTERS: Array<{
  leafOnly?: boolean;
  pattern: (record: EventBusTraceSpan) => boolean;
}> = [
  {
    pattern: (record) =>
      /^BrowserInvariantsLayer\.on_CDPRecv\(/u.test(record.name),
  },
  {
    leafOnly: true,
    pattern: (record) => /^BrowserInvariantsLayer\./u.test(record.name),
  },
  {
    pattern: (record) => /^HumanRecorderLayer\./u.test(record.name),
  },
  {
    leafOnly: true,
    pattern: (record) =>
      /^Browser\.on_CDPRecv\(CDPRecvEvent\(/u.test(record.name),
  },
  {
    leafOnly: true,
    pattern: (record) =>
      /^StagehandSession\.emit\(CDPRecvEvent\(/u.test(record.name),
  },
];

function busTraceFilterAction(
  record: EventBusTraceSpan,
  childRecordsByParentId: Map<string, EventBusTraceSpan[]>,
): "defer" | "handled" | "write" {
  for (const filter of BUS_TRACE_FILTERS) {
    if (!filter.pattern(record)) continue;
    if (filter.leafOnly !== true) return "handled";
    if ((childRecordsByParentId.get(record.spanId)?.length ?? 0) === 0) {
      return "defer";
    }
  }
  return "write";
}

const BRAINTRUST_TRACE_MAPPINGS: BraintrustTraceMapping[] = [
  {
    pattern: isLLMRequestTraceSpan,
    handle: writeLLMRequestSpan,
  },
  {
    pattern: isLLMResponseTraceSpan,
    handle: writeLLMResponseSpan,
  },
  {
    pattern: isLLMErrorTraceSpan,
    handle: writeLLMErrorSpan,
  },
  {
    pattern: isLLMToolTraceSpan,
    handle: writeLLMToolSpan,
  },
  {
    pattern: isEventTraceSpan,
    handle: writeEventSpan,
  },
  {
    pattern: isHandlerTraceSpan,
    handle: writeHandlerSpan,
  },
];

function isLLMRequestTraceSpan(
  record: EventBusTraceSpan,
  ctx: BraintrustTraceContext,
): boolean {
  if (!isEventTraceSpan(record)) return false;
  const eventType = eventTypeFromRecord(record);
  if (eventType === "LLMRequestEvent") return true;
  return (
    eventType != null &&
    LLM_TRACE_PROVIDER_REQUEST_EVENT_TYPES.has(eventType) &&
    !hasAncestorEventType(record, ctx.recordsById, "LLMRequestEvent")
  );
}

function isLLMResponseTraceSpan(record: EventBusTraceSpan): boolean {
  return (
    isEventTraceSpan(record) &&
    eventTypeFromRecord(record) === "LLMResponseEvent"
  );
}

function isLLMErrorTraceSpan(record: EventBusTraceSpan): boolean {
  return (
    isEventTraceSpan(record) && eventTypeFromRecord(record) === "LLMErrorEvent"
  );
}

function isLLMToolTraceSpan(
  record: EventBusTraceSpan,
  ctx: BraintrustTraceContext,
): boolean {
  if (!isEventTraceSpan(record)) return false;
  const eventType = eventTypeFromRecord(record);
  return (
    (eventType === "AgentToolCallCompletedEvent" ||
      eventType === "AgentToolCallErrorEvent") &&
    toolNameForRecord(record, ctx) != null
  );
}

async function writeLLMRequestSpan(
  record: EventBusTraceSpan,
  ctx: BraintrustTraceContext,
): Promise<boolean> {
  const eventType = eventTypeFromRecord(record);
  if (eventType == null) return false;
  const requestId = stringAttribute(record, "request_id");
  const options = recordAttribute(record, "options");
  const model =
    stringAttribute(record, "llm_model_name") ??
    stringValue(options, "llm_model_name");
  const operation = stringAttribute(record, "operation_name");

  const handled = await writeTraceSpan(record, ctx, {
    braintrustName: `${eventType}(${model ?? operation ?? "llm"})`,
    braintrustType: "llm",
    input: llmTraceInput(record),
    metadata: llmTraceMetadata(record, undefined),
  });

  if (!handled) return false;
  if (requestId == null) return true;
  ctx.llmRequestByRequestId.set(requestId, record);
  updateLLMRequestSpan(
    requestId,
    record,
    ctx.llmResponseByRequestId.get(requestId),
    ctx,
  );
  return true;
}

async function writeLLMResponseSpan(
  record: EventBusTraceSpan,
  ctx: BraintrustTraceContext,
): Promise<boolean> {
  const toolCalls = llmTraceToolCalls(record);
  if (toolCalls.length > 0) {
    const scopeId = llmToolTraceScopeId(record, ctx.recordsById);
    const pending = ctx.pendingToolCallsByScopeId.get(scopeId) ?? [];
    pending.push(...toolCalls);
    ctx.pendingToolCallsByScopeId.set(scopeId, pending);
  }
  const requestId = stringAttribute(record, "request_id");
  if (requestId != null) {
    ctx.llmResponseByRequestId.set(requestId, record);
    updateLLMRequestSpan(
      requestId,
      ctx.llmRequestByRequestId.get(requestId),
      record,
      ctx,
    );
  }
  return await writeEventSpan(record, ctx);
}

async function writeLLMErrorSpan(
  record: EventBusTraceSpan,
  ctx: BraintrustTraceContext,
): Promise<boolean> {
  const requestId = stringAttribute(record, "request_id");
  if (requestId != null) {
    updateLLMRequestSpan(
      requestId,
      ctx.llmRequestByRequestId.get(requestId),
      record,
      ctx,
    );
  }
  return await writeEventSpan(record, ctx);
}

async function writeLLMToolSpan(
  record: EventBusTraceSpan,
  ctx: BraintrustTraceContext,
): Promise<boolean> {
  const toolName = toolNameForRecord(record, ctx);
  if (toolName == null) return false;
  const scopeId = llmToolTraceScopeId(record, ctx.recordsById);
  const toolCall = takePendingLLMTraceToolCall(
    ctx.pendingToolCallsByScopeId,
    scopeId,
    toolName,
  );
  const eventType = eventTypeFromRecord(record) ?? "Event";
  return await writeTraceSpan(record, ctx, {
    braintrustName: `${eventBusName(record)}.emit(${eventType}(${toolName}))`,
    braintrustType: "tool",
    input: publicEventAttributes(record, ctx),
    output: firstChildResult(record, ctx.childRecordsByParentId),
    metadata: compactAttributes({
      tool_name: toolName,
      tool_call_id: toolCall?.id ?? stringAttribute(record, "tool_call_id"),
      tool_event_type: eventType,
      llm_request_id:
        toolCall?.request_id ?? stringAttribute(record, "request_id"),
      llm_session_id:
        toolCall?.llm_session_id ?? stringAttribute(record, "llm_session_id"),
    }),
  });
}

async function writeEventSpan(
  record: EventBusTraceSpan,
  ctx: BraintrustTraceContext,
): Promise<boolean> {
  return await writeTraceSpan(record, ctx, {
    input: normalizeScreenshotAttachments(publicEventAttributes(record, ctx)),
    output: normalizeScreenshotAttachments(
      firstChildResult(record, ctx.childRecordsByParentId),
    ),
  });
}

async function writeHandlerSpan(
  record: EventBusTraceSpan,
  ctx: BraintrustTraceContext,
): Promise<boolean> {
  return await writeTraceSpan(record, ctx, {
    input: normalizeScreenshotAttachments(record.attributes),
    output: normalizeScreenshotAttachments(
      firstChildResult(record, ctx.childRecordsByParentId),
    ),
  });
}

async function writeTraceSpan(
  record: EventBusTraceSpan,
  ctx: BraintrustTraceContext,
  input: BraintrustTraceSpanInput,
): Promise<boolean> {
  if (ctx.spansById.has(record.spanId)) return true;
  const parentSpan =
    record.parentSpanId == null
      ? ctx.parent
      : ctx.spansById.get(record.parentSpanId);
  if (parentSpan == null) return false;
  const span = parentSpan.startSpan({
    name: input.braintrustName ?? record.name,
    type: input.braintrustType,
    startTime: secondsFromIso(record.startTime),
    event: spanEvent(input, { includeOutput: input.braintrustType !== "llm" }),
  });
  if (record.error) {
    span.log({ error: record.error });
  }
  span.end({ endTime: secondsFromIso(record.endTime) });
  ctx.spansById.set(record.spanId, span);
  ctx.loggedCount += 1;
  return true;
}

async function updateLoggedTraceSpan(
  record: EventBusTraceSpan,
  ctx: BraintrustTraceContext,
): Promise<void> {
  const span = ctx.spansById.get(record.spanId);
  if (span == null) return;

  const eventUpdate = traceSpanUpdate(record, ctx);
  if (record.error) {
    span.log({
      ...eventUpdate,
      error: record.error,
    });
    return;
  }
  if (Object.keys(eventUpdate).length > 0) {
    span.log(eventUpdate);
  }
}

function traceSpanUpdate(
  record: EventBusTraceSpan,
  ctx: BraintrustTraceContext,
): ExperimentLogPartialArgs {
  if (isLLMToolTraceSpan(record, ctx)) {
    return compactTraceEvent({
      output: normalizeScreenshotAttachments(
        firstChildResult(record, ctx.childRecordsByParentId),
      ),
    });
  }
  if (isHandlerTraceSpan(record)) {
    return compactTraceEvent({
      output: normalizeScreenshotAttachments(
        firstChildResult(record, ctx.childRecordsByParentId),
      ),
    });
  }
  return {};
}

function updateLLMRequestSpan(
  requestId: string,
  request: EventBusTraceSpan | undefined,
  responseOrError: EventBusTraceSpan | undefined,
  ctx: BraintrustTraceContext,
): void {
  const requestSpan =
    request == null ? undefined : ctx.spansById.get(request.spanId);
  if (requestSpan == null || responseOrError == null) return;
  const responseEventType = eventTypeFromRecord(responseOrError);
  if (responseEventType === "LLMErrorEvent") {
    requestSpan.log({
      error:
        stringAttribute(responseOrError, "message") ?? responseOrError.error,
    });
    return;
  }
  const metrics = llmTraceMetrics(request, responseOrError);
  const responseUpdate: ExperimentLogPartialArgs = compactTraceEvent({
    output: llmTraceOutput(responseOrError),
    metadata: llmTraceMetadata(request, responseOrError),
    ...(Object.keys(metrics).length ? { metrics } : {}),
  });
  if (Object.keys(responseUpdate).length === 0) return;
  requestSpan.log(responseUpdate);
}

function llmTraceMetrics(
  request: EventBusTraceSpan | undefined,
  response: EventBusTraceSpan | undefined,
): Record<string, number> {
  const usage = {
    ...rawLLMUsageMetrics(response),
    ...numericRecord(attributeValue(response, "usage")),
  };
  const promptTokens = firstNumericMetric(usage, [
    "prompt_tokens",
    "input_tokens",
    "inputTokens",
    "promptTokenCount",
  ]);
  const completionTokens = firstNumericMetric(usage, [
    "completion_tokens",
    "output_tokens",
    "outputTokens",
    "candidatesTokenCount",
  ]);
  const totalTokens = firstNumericMetric(usage, [
    "total_tokens",
    "totalTokens",
    "totalTokenCount",
    "tokens",
  ]);
  const cachedInputTokens =
    firstNumericMetric(usage, [
      "prompt_cached_tokens",
      "cached_input_tokens",
      "cachedInputTokens",
      "cached_tokens",
      "cache_read_input_tokens",
      "input_tokens_details_cached_tokens",
    ]) ?? sumNumericMetrics(usage, ["cache_read_input_tokens"]);
  const cacheCreationTokens =
    firstNumericMetric(usage, [
      "prompt_cache_creation_tokens",
      "cache_creation_input_tokens",
      "cacheCreationInputTokens",
      "cache_creation_tokens",
    ]) ??
    sumNumericMetrics(usage, [
      "ephemeral_1h_input_tokens",
      "ephemeral_5m_input_tokens",
    ]);
  const reasoningTokens = firstNumericMetric(usage, [
    "reasoning_tokens",
    "reasoningTokens",
    "thinking_tokens",
    "output_tokens_details_reasoning_tokens",
  ]);
  const inferenceTime = llmInferenceTimeSeconds(request, response);
  return compactNumericRecord({
    ...usage,
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    tokens:
      totalTokens ??
      (promptTokens != null || completionTokens != null
        ? (promptTokens ?? 0) + (completionTokens ?? 0)
        : undefined),
    total_tokens: totalTokens,
    prompt_cached_tokens: cachedInputTokens,
    cached_input_tokens: cachedInputTokens,
    cached_tokens: cachedInputTokens,
    prompt_cache_creation_tokens: cacheCreationTokens,
    reasoning_tokens: reasoningTokens,
    thinking_tokens: reasoningTokens,
    inference_time: inferenceTime,
  });
}

function rawLLMUsageMetrics(
  response: EventBusTraceSpan | undefined,
): Record<string, number> {
  const raw = recordValue(attributeValue(response, "raw"));
  const providerMetadata = recordValue(raw?.providerMetadata);
  const rawResponse = recordValue(raw?.response);
  const rawBody = recordValue(rawResponse?.body);
  return collectNumericMetrics([
    providerMetadata,
    recordValue(rawBody?.usage),
    recordValue(rawBody?.usageMetadata),
  ]);
}

function llmInferenceTimeSeconds(
  request: EventBusTraceSpan | undefined,
  response: EventBusTraceSpan | undefined,
): number | undefined {
  const start = secondsFromIso(request?.startTime);
  const end = secondsFromIso(response?.endTime ?? response?.startTime);
  if (start != null && end != null && end >= start) return end - start;

  const headers = recordValue(
    recordValue(attributeValue(response, "raw"))?.response,
  )?.headers;
  const openAIProcessingMs = numericStringValue(
    headers,
    "openai-processing-ms",
  );
  return openAIProcessingMs == null ? undefined : openAIProcessingMs / 1000;
}

function takePendingLLMTraceToolCall(
  pendingToolCallsByScopeId: Map<string, LLMTraceToolCall[]>,
  scopeId: string,
  toolName: string,
): LLMTraceToolCall | undefined {
  const pending = pendingToolCallsByScopeId.get(scopeId);
  if (pending == null) return undefined;
  const index = pending.findIndex((toolCall) => toolCall.name === toolName);
  if (index < 0) return undefined;
  const [toolCall] = pending.splice(index, 1);
  if (pending.length === 0) pendingToolCallsByScopeId.delete(scopeId);
  return toolCall;
}

function llmToolTraceScopeId(
  record: EventBusTraceSpan,
  recordsById: Map<string, EventBusTraceSpan>,
): string {
  let current: EventBusTraceSpan | undefined = record;
  while (current != null) {
    const parent =
      current.parentSpanId == null
        ? undefined
        : recordsById.get(current.parentSpanId);
    if (parent == null) break;
    const eventType = eventTypeFromRecord(parent);
    if (eventType == null || !LLM_TRACE_INTERNAL_EVENT_TYPES.has(eventType)) {
      return parent.spanId;
    }
    current = parent;
  }
  return "root";
}

function hasAncestorEventType(
  record: EventBusTraceSpan,
  recordsById: Map<string, EventBusTraceSpan>,
  eventType: string,
): boolean {
  let current = record;
  while (current.parentSpanId != null) {
    const parent = recordsById.get(current.parentSpanId);
    if (parent == null) return false;
    if (eventTypeFromRecord(parent) === eventType) return true;
    current = parent;
  }
  return false;
}

function llmTraceInput(record: EventBusTraceSpan): unknown {
  const messages = attributeValue(record, "messages");
  if (Array.isArray(messages) && messages.length > 0) return messages;
  const options = recordAttribute(record, "options");
  const optionMessages = recordValue(options)?.messages;
  if (Array.isArray(optionMessages) && optionMessages.length > 0) {
    return optionMessages;
  }
  return [
    {
      role: "user",
      content: String(attributeValue(record, "prompt") ?? ""),
    },
  ];
}

function llmTraceOutput(response: EventBusTraceSpan | undefined): unknown {
  if (response == null) return undefined;
  const output = attributeValue(response, "output");
  const toolCalls = attributeValue(response, "tool_calls");
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    return [
      {
        index: 0,
        message: compactAttributes({
          role: "assistant",
          content: typeof output === "string" ? output : null,
          tool_calls: toolCalls.map(openAITraceToolCall),
        }),
        finish_reason: finishReason(response),
      },
    ];
  }
  if (output !== undefined) return output;
  const toolCall = attributeValue(response, "tool_call");
  if (toolCall !== undefined && toolCall !== null) {
    return [{ index: 0, message: { role: "assistant", tool_call: toolCall } }];
  }
  return undefined;
}

function llmTraceToolCalls(record: EventBusTraceSpan): LLMTraceToolCall[] {
  const requestId = stringAttribute(record, "request_id");
  const llmSessionId = stringAttribute(record, "llm_session_id");
  const toolCalls = attributeValue(record, "tool_calls");
  if (Array.isArray(toolCalls)) {
    return toolCalls.flatMap((value): LLMTraceToolCall[] => {
      const toolCall = recordValue(value);
      const name = stringValue(toolCall, "name");
      if (name == null) return [];
      return [
        {
          name,
          ...(stringValue(toolCall, "id") == null
            ? {}
            : { id: stringValue(toolCall, "id") }),
          ...(llmSessionId == null ? {} : { llm_session_id: llmSessionId }),
          ...(requestId == null ? {} : { request_id: requestId }),
        },
      ];
    });
  }
  const toolCall = stringAttribute(record, "tool_call");
  return toolCall == null
    ? []
    : [
        {
          name: toolCall,
          ...(llmSessionId == null ? {} : { llm_session_id: llmSessionId }),
          ...(requestId == null ? {} : { request_id: requestId }),
        },
      ];
}

function llmTraceMetadata(
  record: EventBusTraceSpan,
  response: EventBusTraceSpan | undefined,
): Record<string, unknown> {
  const options = recordAttribute(record, "options");
  const responseFormat = llmResponseFormat(record, options);
  const raw = recordValue(attributeValue(response, "raw"));
  return compactAttributes({
    model:
      stringAttribute(record, "llm_model_name") ??
      stringValue(options, "llm_model_name"),
    operation_name: attributeValue(record, "operation_name"),
    request_id: attributeValue(record, "request_id"),
    llm_session_id: attributeValue(record, "llm_session_id"),
    parent_request_id: attributeValue(record, "parent_request_id"),
    stagehand_session_id: attributeValue(record, "stagehand_session_id"),
    temperature: recordValue(options)?.temperature,
    top_p: recordValue(options)?.top_p ?? recordValue(options)?.topP,
    max_tokens:
      recordValue(options)?.max_tokens ?? recordValue(options)?.maxOutputTokens,
    tool_choice:
      recordValue(options)?.tool_choice ?? recordValue(options)?.toolChoice,
    tools: recordValue(options)?.tools,
    response_format: responseFormat,
    provider_response_id: attributeValue(response, "provider_response_id"),
    finish_reason: raw?.finishReason,
  });
}

function llmResponseFormat(
  record: EventBusTraceSpan,
  options: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const responseFormat = compactAttributes({
    output: recordValue(options)?.output,
    responseJsonSchema: recordValue(options)?.responseJsonSchema,
    responseSchema: recordValue(options)?.responseSchema,
    response_model: recordValue(options)?.response_model,
    expected_response_schema: attributeValue(
      record,
      "expected_response_schema",
    ),
    response_format:
      attributeValue(record, "response_format") ??
      recordValue(options)?.response_format,
  });
  return Object.keys(responseFormat).length ? responseFormat : undefined;
}

function firstChildResult(
  record: EventBusTraceSpan,
  childRecordsByParentId: Map<string, EventBusTraceSpan[]>,
): unknown {
  if (record.result !== undefined) return record.result;
  return childRecordsByParentId
    .get(record.spanId)
    ?.find((child) => child.result !== undefined)?.result;
}

function eventBusName(record: EventBusTraceSpan): string {
  const nameMatch = /^(.+)\.emit\(/.exec(record.name);
  return (
    stringAttribute(record, "abxbus.event_bus.name") ??
    nameMatch?.[1] ??
    "EventBus"
  );
}

function isEventTraceSpan(record: EventBusTraceSpan): boolean {
  return /^.+\.emit\(/.test(record.name);
}

function isHandlerTraceSpan(record: EventBusTraceSpan): boolean {
  return (
    !isEventTraceSpan(record) && /\([^()]+(?:\([^)]*\))?\)$/.test(record.name)
  );
}

function eventTypeFromRecord(record: EventBusTraceSpan): string | undefined {
  const eventSpanMatch = /^.+\.emit\(([^()]+)(?:\([^)]*\))?\)$/.exec(
    record.name,
  );
  if (eventSpanMatch?.[1] != null) return eventSpanMatch[1];
  const handlerSpanMatch = /\(([^()]+)(?:\([^)]*\))?\)$/.exec(record.name);
  return handlerSpanMatch?.[1];
}

function toolDefinitionForRecord(
  record: EventBusTraceSpan,
  ctx: BraintrustTraceContext,
): BraintrustTraceToolDefinition | undefined {
  const eventType = eventTypeFromRecord(record);
  return eventType == null
    ? undefined
    : ctx.toolDefinitionByEventType.get(eventType);
}

function toolNameForRecord(
  record: EventBusTraceSpan,
  ctx: BraintrustTraceContext,
): string | undefined {
  return (
    stringAttribute(record, "llm_tool_name") ??
    toolDefinitionForRecord(record, ctx)?.name
  );
}

function secondsFromIso(value: string | undefined): number | undefined {
  if (value == null) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? undefined : milliseconds / 1000;
}

function spanEvent(
  record: BraintrustTraceSpanInput,
  options: { includeOutput: boolean },
): ExperimentLogPartialArgs | undefined {
  return compactTraceEvent({
    input: normalizeScreenshotAttachments(record.input),
    output: options.includeOutput
      ? normalizeScreenshotAttachments(record.output)
      : undefined,
    metadata: record.metadata,
    metrics: options.includeOutput ? record.metrics : undefined,
  });
}

function openAITraceToolCall(value: unknown): Record<string, unknown> {
  const toolCall = recordValue(value);
  const name = stringValue(toolCall, "name") ?? "";
  const args = recordValue(toolCall)?.arguments;
  return compactAttributes({
    id: stringValue(toolCall, "id"),
    type: "function",
    function: compactAttributes({
      name,
      arguments:
        args === undefined
          ? undefined
          : typeof args === "string"
            ? args
            : JSON.stringify(args),
    }),
  });
}

function finishReason(response: EventBusTraceSpan): unknown {
  const raw = recordValue(attributeValue(response, "raw"));
  return raw?.finishReason ?? raw?.finish_reason;
}

function compactTraceEvent(
  input: ExperimentLogPartialArgs,
): ExperimentLogPartialArgs {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => {
      if (value === undefined) return false;
      if (value != null && typeof value === "object" && !Array.isArray(value)) {
        return Object.keys(value as Record<string, unknown>).length > 0;
      }
      return true;
    }),
  ) as ExperimentLogPartialArgs;
}

function publicEventAttributes(
  record: EventBusTraceSpan,
  ctx: BraintrustTraceContext,
): Record<string, unknown> {
  const attributes = Object.fromEntries(
    Object.entries(record.attributes ?? {}).filter(
      ([key]) => !key.startsWith("abxbus."),
    ),
  );
  const toolDefinition = toolDefinitionForRecord(record, ctx);
  return compactAttributes({
    ...attributes,
    llm_tool_name: attributes.llm_tool_name ?? toolDefinition?.name,
    llm_tool_description:
      attributes.llm_tool_description ?? toolDefinition?.description,
  });
}

function normalizeScreenshotAttachments(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeScreenshotAttachments);
  if (value == null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      const normalizedEntry =
        typeof entry === "string" && isScreenshotField(key, entry)
          ? inlineScreenshotAttachment(entry)
          : normalizeScreenshotAttachments(entry);
      return [key, normalizedEntry];
    }),
  );
}

function isScreenshotField(key: string, value: string): boolean {
  return (
    key === "screenshot" ||
    key === "screenshotBase64" ||
    (key === "data" && looksLikeBase64Image(value))
  );
}

function looksLikeBase64Image(value: string): boolean {
  return (
    value.startsWith("data:image/") ||
    value.startsWith("iVBOR") ||
    value.startsWith("/9j/") ||
    value.startsWith("R0lGOD") ||
    value.startsWith("UklGR")
  );
}

function inlineScreenshotAttachment(value: string): unknown {
  if (value.length === 0) return value;
  const url = value.startsWith("data:")
    ? value
    : `data:image/png;base64,${value}`;
  return { image_url: { url } };
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

function compactNumericRecord(
  input: Record<string, number | undefined>,
): Record<string, number> {
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
}

function collectNumericMetrics(values: unknown[]): Record<string, number> {
  const metrics: Record<string, number> = {};
  for (const value of values) {
    collectNumericMetricValue(value, [], metrics);
  }
  return metrics;
}

function collectNumericMetricValue(
  value: unknown,
  path: string[],
  metrics: Record<string, number>,
): void {
  if (typeof value === "number" && Number.isFinite(value)) {
    const key = path.at(-1);
    if (key != null) metrics[key] ??= value;
    if (path.length > 1) metrics[path.join("_")] ??= value;
    return;
  }
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  for (const [key, nestedValue] of Object.entries(value)) {
    collectNumericMetricValue(nestedValue, [...path, key], metrics);
  }
}

function firstNumericMetric(
  metrics: Record<string, number>,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

function sumNumericMetrics(
  metrics: Record<string, number>,
  keys: string[],
): number | undefined {
  let total = 0;
  let found = false;
  for (const key of keys) {
    const value = metrics[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    total += value;
    found = true;
  }
  return found ? total : undefined;
}

function numericRecord(value: unknown): Record<string, number> {
  const record = recordValue(value);
  if (record == null) return {};
  return Object.fromEntries(
    Object.entries(record).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}

function stringAttribute(
  record: EventBusTraceSpan | undefined,
  key: string,
): string | undefined {
  return stringValue(record?.attributes, key);
}

function recordAttribute(
  record: EventBusTraceSpan | undefined,
  key: string,
): Record<string, unknown> | undefined {
  return recordValue(attributeValue(record, key));
}

function attributeValue(
  record: EventBusTraceSpan | undefined,
  key: string,
): unknown {
  return record?.attributes?.[key];
}

function stringValue(value: unknown, key: string): string | undefined {
  const entry = recordValue(value)?.[key];
  return typeof entry === "string" && entry.length > 0 ? entry : undefined;
}

function numericStringValue(value: unknown, key: string): number | undefined {
  const entry = recordValue(value)?.[key];
  if (typeof entry !== "string" || entry.length === 0) return undefined;
  const parsed = Number(entry);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
