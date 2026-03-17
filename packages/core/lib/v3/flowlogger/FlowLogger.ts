import { AsyncLocalStorage } from "node:async_hooks";
import { v7 as uuidv7 } from "uuid";
import type { LanguageModelMiddleware } from "ai";
import { z } from "zod";
import { EventEmitterWithWildcardSupport } from "./EventEmitter.js";

// =============================================================================
// Flow Event Model
// =============================================================================

export const FlowEventDataSchema = z.record(z.string(), z.unknown());
export const FlowEventInputSchema = z.object({
  eventType: z.string(),
  eventId: z.string().optional(),
  eventParentIds: z.array(z.string()).optional(),
  eventCreatedAt: z.string().optional(),
  sessionId: z.string().optional(),
  data: FlowEventDataSchema.optional(),
});

export type FlowEventData = z.infer<typeof FlowEventDataSchema>;
export type FlowEventInput = z.input<typeof FlowEventInputSchema>;

// the same as FlowEventInput, but with all fields required (non-optional)
type FlowEventFields = Omit<
  FlowEventInput,
  "eventId" | "eventParentIds" | "eventCreatedAt" | "sessionId" | "data"
> & {
  eventId: string;
  eventParentIds: string[];
  eventCreatedAt: string;
  sessionId: string;
  data: FlowEventData;
};

export class FlowEvent implements FlowEventFields {
  // "ModuleMethodSomethingEvent" -> hashToSmallInt("Modu) -> 5. eventId = "...5"
  private static deriveEventIdSuffix(eventType: string): string {
    const prefixMatch = eventType.match(/^[A-Z][a-z0-9]*/);
    const prefix = prefixMatch?.[0] ?? eventType.slice(0, 4);

    let hash = 0;
    for (const ch of prefix.slice(0, 4)) {
      hash = (hash * 31 + ch.charCodeAt(0)) % 10;
    }
    return String(hash); // e.g. "0" or "9"
  }

  // Builds a sortable UUID-like event id while preserving a stable, human-friendly suffix derived from the event family.
  static createEventId(eventType: string): string {
    const rawEventId = uuidv7();
    return `${rawEventId.slice(0, -1)}${FlowEvent.deriveEventIdSuffix(eventType)}`;
  }

  // Base required fields for all events:
  eventType: string;
  eventId: string;
  eventParentIds: string[];
  eventCreatedAt: string;
  // `sessionId` usually matches `browserbaseSessionId` today, but FlowLogger treats it as a generic Stagehand session identifier because those may diverge in the future.
  sessionId: string;
  data: FlowEventData; // event payload (e.g. params, action, result, error, etc.)

  // Normalizes the event shape used everywhere in the flow logger pipeline. This is called at emission time right before an event is attached to the event bus and any sinks.
  constructor(input: FlowEventInput) {
    if (!input.sessionId) {
      throw new Error("FlowEvent.sessionId is required.");
    }
    if (input.eventType.endsWith("Event")) {
      this.eventType = input.eventType;
    } else {
      this.eventType = `${input.eventType}Event`;
    }
    this.eventId = input.eventId ?? FlowEvent.createEventId(this.eventType);
    this.eventParentIds = input.eventParentIds ?? [];
    this.eventCreatedAt = input.eventCreatedAt ?? new Date().toISOString();
    this.sessionId = input.sessionId;
    this.data = input.data ?? {};
  }
}

export interface FlowLoggerContext {
  // Mirrors `FlowEvent.sessionId`; it is currently the Stagehand session id and often matches `browserbaseSessionId`, but callers should not rely on that.
  sessionId: string;
  eventBus: EventEmitterWithWildcardSupport; // Shared per-session bus; `emit()` writes to it and V3 forwards wildcard events into the instance-owned EventStore.
  parentEvents: FlowEvent[]; // Active parent stack for the current async chain; wrappers push/pop this as logged work starts and ends.
}

type AsyncOriginalMethod<
  TArgs extends unknown[] = unknown[],
  TResult = unknown,
  TThis = unknown,
> = (this: TThis, ...args: TArgs) => Promise<TResult>;

type FlowLoggerLogOptions = FlowEventInput & {
  context?: FlowLoggerContext;
};

// AsyncLocalStorage is the authoritative source for the active flow parent stack inside a single async call-chain.
const loggerContext = new AsyncLocalStorage<FlowLoggerContext>();

// Converts raw inline image/base64 payload lengths into a compact kb string for LLM prompt summaries.
function dataToKb(data: string): string {
  return ((data.length * 0.75) / 1024).toFixed(1);
}

// =============================================================================
// Flow Logger Internals
// =============================================================================

type CdpLogEventType = "call" | "response" | "responseError" | "message";

type CdpLogPayload = {
  method: string;
  params?: unknown;
  result?: unknown;
  error?: string;
  targetId?: string | null;
};

const CDP_EVENT_NAMES: Record<CdpLogEventType, string> = {
  call: "CdpCallEvent",
  response: "CdpResponseEvent",
  responseError: "CdpResponseErrorEvent",
  message: "CdpMessageEvent",
};

export class FlowLogger {
  // Copies the mutable parts of a context before it is re-entered in a later async callback. This prevents later parent-stack mutations from leaking backward into stored snapshots.
  private static cloneContext(ctx: FlowLoggerContext): FlowLoggerContext {
    return {
      ...ctx,
      parentEvents: ctx.parentEvents.map((event) => ({
        ...event,
        eventParentIds: [...event.eventParentIds],
      })),
    };
  }

  // Chooses the safest context to re-enter when callers already have a stored context
  // and ALS may or may not already contain one for the same session.
  // If the current ALS stack extends the stored stack, we keep the richer ALS view.
  // If the stored stack is deeper, we preserve that instead.
  // If they diverge, we prefer the current ALS view because it reflects the currently executing call-chain.
  private static resolveReentryContext(
    context: FlowLoggerContext,
  ): FlowLoggerContext {
    const currentContext = loggerContext.getStore() ?? null;
    // If ALS is empty or belongs to another session, the caller's stored
    // snapshot is the only safe context we can re-enter.
    if (!currentContext || currentContext.sessionId !== context.sessionId) {
      return FlowLogger.cloneContext(context);
    }

    const providedParentIds = context.parentEvents.map(
      (event) => event.eventId,
    );
    const currentParentIds = currentContext.parentEvents.map(
      (event) => event.eventId,
    );
    const currentExtendsProvided = providedParentIds.every(
      (eventId, index) => currentParentIds[index] === eventId,
    );
    // ALS already has the provided chain as a prefix, so we keep the richer
    // currently-executing stack instead of truncating it.
    if (currentExtendsProvided) {
      return FlowLogger.cloneContext(currentContext);
    }

    const providedExtendsCurrent = currentParentIds.every(
      (eventId, index) => providedParentIds[index] === eventId,
    );
    // The stored snapshot is deeper than the current ALS stack, which usually
    // means we are re-entering from a later async callback and need to restore
    // the missing parent chain.
    if (providedExtendsCurrent) {
      return FlowLogger.cloneContext(context);
    }

    // If the two chains diverged, prefer the live ALS chain because it reflects
    // the work currently executing on this async path.
    return FlowLogger.cloneContext(currentContext);
  }

  // Materializes and emits a single flow event on the active ALS context.
  // This is the lowest-level write path used by all higher-level logging helpers
  // after they have decided which parent chain and session the event belongs to.
  private static emit(event: FlowEventInput): FlowEvent | null {
    const ctx = FlowLogger.currentContext;

    const emittedEvent = new FlowEvent({
      ...event,
      eventParentIds:
        event.eventParentIds ??
        ctx.parentEvents.map((parent) => parent.eventId),
      sessionId: ctx.sessionId,
    });
    ctx.eventBus.emit(emittedEvent.eventType, emittedEvent);
    return emittedEvent;
  }

  // Wraps a unit of async work with started/completed/error events while maintaining
  // the parent stack inside the active context.
  private static async runWithAutoStatusEventLogging<TResult>(
    options: FlowLoggerLogOptions,
    originalMethod: AsyncOriginalMethod<[], TResult>,
  ): Promise<TResult> {
    const ctx = FlowLogger.currentContext;
    const { data, eventParentIds, eventType } = options;
    let caughtError: unknown = null;

    // if eventParentIds is explicitly [], this is a root event, clear the parent events in context
    if (eventParentIds && eventParentIds.length === 0) {
      ctx.parentEvents = [];
    }

    const startedEvent = FlowLogger.emit({
      eventType,
      data,
      eventParentIds,
    });

    // Push after emitting so nested work sees this event as its direct parent
    // for the rest of the wrapped method's lifetime.
    ctx.parentEvents.push(startedEvent);

    try {
      return await originalMethod();
    } catch (error) {
      caughtError = error;
      // Error events attach directly under the started event even though the
      // stack is still live, so the failure edge is explicit in the tree.
      FlowLogger.emit({
        eventType: `${eventType}ErrorEvent`,
        eventParentIds: [...startedEvent.eventParentIds, startedEvent.eventId],
        data: {
          error: error instanceof Error ? error.message : String(error),
          durationMs:
            Date.now() - new Date(startedEvent.eventCreatedAt).getTime(),
        },
      });
      throw error;
    } finally {
      // Pop only the frame owned by this wrapper. If nested code has already
      // mutated the stack unexpectedly, we skip the completed event rather than
      // emitting a misleading lifecycle edge.
      const parentEvent = ctx.parentEvents.pop();
      if (parentEvent?.eventId === startedEvent.eventId && !caughtError) {
        FlowLogger.emit({
          eventType: `${eventType}CompletedEvent`,
          eventParentIds: [
            ...startedEvent.eventParentIds,
            startedEvent.eventId,
          ],
          data: {
            durationMs:
              Date.now() - new Date(startedEvent.eventCreatedAt).getTime(),
          },
        });
      }
    }
  }

  // Emits a CDP event under a caller-supplied context. CDP transport code uses this
  // instead of `runWithLogging()` because request/response/message events
  // are separate lifecycle edges with explicit parent ids.
  private static logCdpEvent(
    context: FlowLoggerContext,
    eventType: CdpLogEventType,
    { method, params, result, error, targetId }: CdpLogPayload,
    eventParentIds?: string[],
  ): FlowEvent | null {
    if (method.endsWith(".enable") || method === "enable") {
      return null;
    }

    if (eventType === "message" && FlowLogger.NOISY_CDP_EVENTS.has(method)) {
      return null;
    }

    return loggerContext.run(FlowLogger.cloneContext(context), () =>
      FlowLogger.emit({
        eventType: CDP_EVENT_NAMES[eventType],
        eventParentIds,
        data: {
          method,
          params,
          result,
          error,
          targetId,
        },
      }),
    );
  }

  // Emits an LLM request/response event only when a flow context is active.
  // LLM logging is best-effort, so callers should not fail if it is invoked outside a tracked async chain.
  private static emitLlmEvent(event: FlowEventInput): void {
    const context = FlowLogger.resolveContext();
    if (!context) {
      return;
    }

    loggerContext.run(context, () => {
      FlowLogger.emit(event);
    });
  }

  // Builds the one-line prompt summary used in LLM request events for AI SDK middleware calls.
  private static buildMiddlewarePromptSummary(params: {
    prompt?: unknown;
    tools?: unknown;
  }): string {
    const toolCount = Array.isArray(params.tools) ? params.tools.length : 0;
    const messages = (params.prompt ?? []) as Array<{
      role?: string;
      content?: unknown;
    }>;
    const lastMsg = messages
      .filter((message) => message.role !== "system")
      .pop();
    let rolePrefix = lastMsg?.role ?? "?";
    let promptSummary = `(no text) +{${toolCount} tools}`;

    if (!lastMsg) {
      return `?: ${promptSummary}`;
    }

    if (typeof lastMsg.content === "string") {
      promptSummary = `${lastMsg.content} +{${toolCount} tools}`;
    } else if (Array.isArray(lastMsg.content)) {
      const toolResult = (
        lastMsg.content as Array<{
          type?: string;
          toolName?: string;
          output?: { type?: string; value?: unknown };
        }>
      ).find((part) => part.type === "tool-result");

      if (toolResult) {
        rolePrefix = `tool result: ${toolResult.toolName}()`;
        if (toolResult.output?.type === "json" && toolResult.output.value) {
          promptSummary = `${JSON.stringify(toolResult.output.value)} +{${toolCount} tools}`;
        } else if (Array.isArray(toolResult.output?.value)) {
          promptSummary = `${
            extractLlmMessageSummary({
              content: toolResult.output.value,
            }) ?? "(no text)"
          } +{${toolCount} tools}`;
        }
      } else {
        promptSummary = `${
          extractLlmMessageSummary({ content: lastMsg.content }) ?? "(no text)"
        } +{${toolCount} tools}`;
      }
    }

    return `${rolePrefix}: ${promptSummary}`;
  }

  // Builds the one-line output summary used in LLM response events for AI SDK middleware calls.
  private static buildMiddlewareOutputSummary(result: {
    text?: string;
    content?: unknown;
    toolCalls?: unknown[];
  }): string {
    let outputSummary = result.text || "";
    if (!outputSummary && result.content) {
      if (typeof result.content === "string") {
        outputSummary = result.content;
      } else if (Array.isArray(result.content)) {
        outputSummary = (
          result.content as Array<{
            type?: string;
            text?: string;
            toolName?: string;
          }>
        )
          .map((contentPart) => {
            if (contentPart.text) {
              return contentPart.text;
            }

            if (contentPart.type === "tool-call") {
              return `tool call: ${contentPart.toolName}()`;
            }

            return `[${contentPart.type}]`;
          })
          .join(" ");
      }
    }

    if (!outputSummary && result.toolCalls?.length) {
      return `[${result.toolCalls.length} tool calls]`;
    }

    return outputSummary || "[empty]";
  }

  // =============================================================================
  // Flow Logger Public Lifecycle API
  // =============================================================================

  // Initialize a new logging context. Call this at the start of a session.
  static init(
    sessionId: string,
    eventBus: EventEmitterWithWildcardSupport,
  ): FlowLoggerContext {
    const ctx: FlowLoggerContext = {
      sessionId,
      eventBus,
      parentEvents: [],
    };

    loggerContext.enterWith(ctx);
    return ctx;
  }

  // Clears the parent stack for a session when a V3 instance shuts down.
  // This does not emit a final event; it just tears down in-memory context.
  static async close(context?: FlowLoggerContext | null): Promise<void> {
    const ctx = context ?? loggerContext.getStore() ?? null;
    if (!ctx) return;
    ctx.parentEvents = [];
  }

  // Returns the current ALS-backed flow context and throws when code
  // executes outside a tracked flow. Use `resolveContext()` for best-effort lookups.
  static get currentContext(): FlowLoggerContext {
    const ctx = loggerContext.getStore() ?? null;
    if (!ctx) {
      throw new Error("FlowLogger context is missing.");
    }

    return ctx;
  }

  // Returns a cloned FlowLogger context for the current async call-chain when one exists,
  // otherwise falls back to the provided instance-owned context.
  // This is the non-throwing lookup for callers that can continue without ALS.
  static resolveContext(
    fallbackContext?: FlowLoggerContext | null,
  ): FlowLoggerContext | null {
    const currentContext = loggerContext.getStore() ?? null;
    if (currentContext) {
      return FlowLogger.cloneContext(currentContext);
    }

    return fallbackContext ? FlowLogger.cloneContext(fallbackContext) : null;
  }

  // Decorator-style wrapper used on class methods that should emit their own started/completed/error envelope.
  // It resolves the flow context from either the decorator options or `this.flowLoggerContext`,
  // then delegates the actual lifecycle handling to `runWithLogging()`.
  static wrapWithLogging<TMethod extends AsyncOriginalMethod>(
    options: FlowLoggerLogOptions,
  ) {
    return function <
      TWrappedMethod extends AsyncOriginalMethod<
        Parameters<TMethod>,
        Awaited<ReturnType<TMethod>>,
        ThisParameterType<TMethod>
      >,
    >(originalMethod: TWrappedMethod): TWrappedMethod {
      const wrappedMethod = async function (
        this: ThisParameterType<TWrappedMethod>,
        ...args: Parameters<TWrappedMethod>
      ): Promise<Awaited<ReturnType<TWrappedMethod>>> {
        let context = options.context;
        if (!context) {
          context = (
            this as { flowLoggerContext?: FlowLoggerContext } | null | undefined
          )?.flowLoggerContext;
        }

        return await FlowLogger.runWithLogging(
          {
            ...options,
            context,
          },
          (...boundArgs: Parameters<TWrappedMethod>) =>
            originalMethod.apply(this, boundArgs) as Promise<
              Awaited<ReturnType<TWrappedMethod>>
            >,
          args,
        );
      };

      return wrappedMethod as unknown as TWrappedMethod;
    };
  }

  // Wraps an async function or zero-arg closure with flow events.
  // This is the imperative entrypoint used by handlers that cannot use the decorator form.
  // Standard case: the logged params are the same tuple passed to the wrapped method.
  static runWithLogging<TMethod extends AsyncOriginalMethod>(
    options: FlowLoggerLogOptions,
    originalMethod: TMethod,
    params: Readonly<Parameters<TMethod>>,
  ): Promise<Awaited<ReturnType<TMethod>>>;
  // Special case: log an arbitrary params tuple while executing a zero-arg closure.
  static runWithLogging<TResult>(
    options: FlowLoggerLogOptions,
    originalMethod: AsyncOriginalMethod<[], TResult>,
    params: ReadonlyArray<unknown>,
  ): Promise<Awaited<TResult>>;
  static runWithLogging(
    options: FlowLoggerLogOptions,
    originalMethod: AsyncOriginalMethod<unknown[], unknown>,
    params: ReadonlyArray<unknown>,
  ): Promise<unknown> {
    const eventData = {
      ...(options.data ?? {}),
      params: [...params],
    };

    const execute = (): Promise<unknown> =>
      FlowLogger.runWithAutoStatusEventLogging(
        {
          ...options,
          data: eventData,
        },
        () => originalMethod(...params),
      );

    // No explicit context and no active ALS means there is nothing to attach
    // this work to, so we leave execution untouched instead of fabricating a
    // root event.
    if (!options.context && !(loggerContext.getStore() ?? null)) {
      return originalMethod(...params);
    }

    if (options.context) {
      // Re-enter the caller-owned context so wrapper events land under the same
      // session tree even when this code executes outside the original ALS
      // chain.
      return loggerContext.run(
        FlowLogger.resolveReentryContext(options.context),
        execute,
      );
    }

    return execute();
  }

  // Re-enters an existing FlowLogger context without emitting wrapper events.
  // Use this when work already belongs to a known parent and needs AsyncLocalStorage set manually.
  static withContext<T>(context: FlowLoggerContext, fn: () => T): T {
    return loggerContext.run(FlowLogger.resolveReentryContext(context), fn);
  }

  // ===========================================================================
  // CDP Events
  // ===========================================================================

  private static readonly NOISY_CDP_EVENTS = new Set([
    "Target.targetInfoChanged",
    "Runtime.executionContextCreated",
    "Runtime.executionContextDestroyed",
    "Runtime.executionContextsCleared",
    "Page.lifecycleEvent",
    "Network.dataReceived",
    "Network.loadingFinished",
    "Network.requestWillBeSentExtraInfo",
    "Network.responseReceivedExtraInfo",
    "Network.requestWillBeSent",
    "Network.responseReceived",
  ]);

  // Logs the start of a CDP command. CDP transport calls this before sending a
  // message over the websocket so the eventual response can attach to it.
  static logCdpCallEvent(
    context: FlowLoggerContext,
    data: {
      method: string;
      params?: object;
      targetId?: string | null;
    },
  ): FlowEvent | null {
    return FlowLogger.logCdpEvent(context, "call", data);
  }

  // Logs the terminal response for a previously emitted CDP call event.
  static logCdpResponseEvent(
    context: FlowLoggerContext,
    parentEvent: Pick<FlowEvent, "eventId" | "eventParentIds">,
    data: {
      method: string;
      result?: unknown;
      error?: string;
      targetId?: string | null;
    },
  ): void {
    FlowLogger.logCdpEvent(
      context,
      data.error ? "responseError" : "response",
      data,
      [...parentEvent.eventParentIds, parentEvent.eventId],
    );
  }

  // Logs an unsolicited CDP message under the most recent related call event.
  static logCdpMessageEvent(
    context: FlowLoggerContext,
    parentEvent: Pick<FlowEvent, "eventId" | "eventParentIds">,
    data: {
      method: string;
      params?: unknown;
      targetId?: string | null;
    },
  ): void {
    FlowLogger.logCdpEvent(context, "message", data, [
      ...parentEvent.eventParentIds,
      parentEvent.eventId,
    ]);
  }

  // ===========================================================================
  // LLM Events
  // ===========================================================================

  // Emits a best-effort LLM request event when logging occurs inside an active flow context.
  static logLlmRequest({
    requestId,
    model,
    prompt,
  }: {
    requestId: string;
    model: string;
    prompt?: string;
  }): void {
    FlowLogger.emitLlmEvent({
      eventType: "LlmRequestEvent",
      data: {
        requestId,
        model,
        prompt,
      },
    });
  }

  // Emits a best-effort LLM response event when logging occurs inside an active flow context.
  static logLlmResponse({
    requestId,
    model,
    output,
    inputTokens,
    outputTokens,
  }: {
    requestId: string;
    model: string;
    output?: string;
    inputTokens?: number;
    outputTokens?: number;
  }): void {
    FlowLogger.emitLlmEvent({
      eventType: "LlmResponseEvent",
      data: {
        requestId,
        model,
        output,
        inputTokens,
        outputTokens,
      },
    });
  }

  // ===========================================================================
  // LLM Logging Middleware
  // ===========================================================================

  // Creates AI SDK middleware that wraps a generate call with FlowLogger LLM request/response events
  // while leaving model execution behavior unchanged.
  static createLlmLoggingMiddleware(
    modelId: string,
  ): Pick<LanguageModelMiddleware, "wrapGenerate"> {
    return {
      wrapGenerate: async ({ doGenerate, params }) => {
        const llmRequestId = uuidv7();
        FlowLogger.logLlmRequest({
          requestId: llmRequestId,
          model: modelId,
          prompt: FlowLogger.buildMiddlewarePromptSummary(params),
        });

        const result = await doGenerate();

        const res = result as {
          text?: string;
          content?: unknown;
          toolCalls?: unknown[];
        };

        FlowLogger.logLlmResponse({
          requestId: llmRequestId,
          model: modelId,
          output: FlowLogger.buildMiddlewareOutputSummary(res),
          inputTokens: result.usage?.inputTokens,
          outputTokens: result.usage?.outputTokens,
        });

        return result;
      },
    };
  }
}

// =============================================================================
// LLM Event Extraction Helpers
// =============================================================================

type ContentPart = {
  type?: string;
  text?: string;
  content?: unknown[];
  source?: { data?: string };
  image_url?: { url?: string };
  inlineData?: { data?: string };
};

type LlmMessageContent = {
  content?: unknown;
  text?: string;
  parts?: unknown[];
};

// Extracts text and image markers from an LLM content array.
// This is shared by the request-summary helpers below so different provider message
// shapes render consistently in the flow log.
function extractLlmMessageContent(content: unknown[]): {
  text?: string;
  extras: string[];
} {
  const result = {
    text: undefined as string | undefined,
    extras: [] as string[],
  };

  for (const part of content) {
    const p = part as ContentPart;
    // Text
    if (!result.text && p.text) {
      result.text = p.type === "text" || !p.type ? p.text : undefined;
    }
    // Images - various formats
    if (p.type === "image" || p.type === "image_url") {
      const url = p.image_url?.url;
      if (url?.startsWith("data:"))
        result.extras.push(`${dataToKb(url)}kb image`);
      else if (p.source?.data)
        result.extras.push(`${dataToKb(p.source.data)}kb image`);
      else result.extras.push("image");
    } else if (p.source?.data) {
      result.extras.push(`${dataToKb(p.source.data)}kb image`);
    } else if (p.inlineData?.data) {
      result.extras.push(`${dataToKb(p.inlineData.data)}kb image`);
    }
    // Recurse into tool_result content
    if (p.type === "tool_result" && Array.isArray(p.content)) {
      const nested = extractLlmMessageContent(p.content);
      if (!result.text && nested.text) {
        result.text = nested.text;
      }
      result.extras.push(...nested.extras);
    }
  }

  return result;
}

// Produces a single compact summary from a provider-specific message payload
// so request and tool-result logs stay readable.
function extractLlmMessageSummary(
  input: LlmMessageContent,
  options?: {
    trimInstructionPrefix?: boolean;
    extras?: string[];
  },
): string | undefined {
  const result = {
    text: undefined as string | undefined,
    extras: [...(options?.extras ?? [])],
  };

  if (typeof input.content === "string") {
    result.text = input.content;
  } else if (typeof input.text === "string") {
    result.text = input.text;
  } else if (Array.isArray(input.parts)) {
    const summary = extractLlmMessageContent(input.parts);
    result.text = summary.text;
    result.extras.push(...summary.extras);
  } else if (Array.isArray(input.content)) {
    const summary = extractLlmMessageContent(input.content);
    result.text = summary.text;
    result.extras.push(...summary.extras);
  }

  if (options?.trimInstructionPrefix && result.text) {
    result.text = result.text.replace(/^[Ii]nstruction: /, "");
  }

  const text = result.text;
  if (!text && result.extras.length === 0) return undefined;

  let summary = text || "";
  if (result.extras.length > 0) {
    const extrasStr = result.extras.map((e) => `+{${e}}`).join(" ");
    summary = summary ? `${summary} ${extrasStr}` : extrasStr;
  }
  return summary || undefined;
}

// Formats the last user-facing prompt into the one-line form used by standard LLM request logs,
// for example: `some text +{5.8kb image} +{schema}`.
export function extractLlmPromptSummary(
  messages: Array<{ role: string; content: unknown }>,
  options?: { toolCount?: number; hasSchema?: boolean },
): string | undefined {
  try {
    const lastUserMsg = messages.filter((m) => m.role === "user").pop();
    if (!lastUserMsg) return undefined;

    return extractLlmMessageSummary(lastUserMsg, {
      trimInstructionPrefix: true,
      extras: [
        ...(options?.hasSchema ? ["schema"] : []),
        ...(options?.toolCount ? [`${options.toolCount} tools`] : []),
      ],
    });
  } catch {
    return undefined;
  }
}

// Extract a text summary from CUA-style messages. This accepts Anthropic, OpenAI, and Google-style payloads.
export function extractLlmCuaPromptSummary(
  messages: unknown[],
): string | undefined {
  try {
    const lastMsg = messages
      .filter((m) => {
        const msg = m as { role?: string; type?: string };
        return msg.role === "user" || msg.type === "tool_result";
      })
      .pop() as
      | { content?: unknown; parts?: unknown[]; text?: string }
      | undefined;

    if (!lastMsg) return undefined;

    return extractLlmMessageSummary(lastMsg);
  } catch {
    return undefined;
  }
}

// Formats the response side of a CUA exchange into a single short log line.
export function extractLlmCuaResponseSummary(output: unknown): string {
  try {
    const items: unknown[] =
      (output as { candidates?: [{ content?: { parts?: unknown[] } }] })
        ?.candidates?.[0]?.content?.parts ??
      (Array.isArray(output) ? output : []);

    const summary = items
      .map((item) => {
        const i = item as {
          type?: string;
          text?: string;
          name?: string;
          functionCall?: { name?: string };
        };
        if (i.text) return i.text;
        if (i.functionCall?.name) return i.functionCall.name;
        if (i.type === "tool_use" && i.name) return i.name;
        return i.type ?? "[item]";
      })
      .join(" ");

    return summary;
  } catch {
    return "[error]";
  }
}
