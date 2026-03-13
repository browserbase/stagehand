import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { v7 as uuidv7 } from "uuid";
import type { LanguageModelMiddleware } from "ai";

// =============================================================================
// Constants
// =============================================================================

export type FlowEventData = Record<string, unknown>;
export type FlowEventInput = Omit<
  FlowEvent,
  "eventId" | "createdAt" | "sessionId" | "eventParentIds" | "data"
> & {
  eventId?: string;
  eventIdSuffix?: string;
  createdAt?: string;
  sessionId?: string;
  eventParentIds?: string[];
  data?: FlowEventData;
};

export class FlowEvent {
  static createEventId(eventIdSuffix: string): string {
    const rawEventId = uuidv7();
    return `${rawEventId.slice(0, -1)}${eventIdSuffix || "0"}`;
  }

  // base required fields for all events:
  eventType: string;
  eventId: string;
  eventParentIds: string[];
  createdAt: string;
  sessionId: string;
  data: FlowEventData; // event payload (e.g. params, action, result, error, etc.)

  constructor(input: FlowEventInput) {
    if (!input.sessionId) {
      throw new Error("FlowEvent.sessionId is required.");
    }
    if (
      input.eventId &&
      input.eventIdSuffix &&
      !input.eventId.endsWith(input.eventIdSuffix)
    ) {
      throw new Error("FlowEvent cannot take both eventId and eventIdSuffix.");
    }

    this.eventType = input.eventType.endsWith("Event")
      ? input.eventType
      : `${input.eventType}Event`;
    this.eventId =
      input.eventId ?? FlowEvent.createEventId(input.eventIdSuffix ?? "0");
    this.eventParentIds = input.eventParentIds ?? [];
    this.createdAt = input.createdAt ?? new Date().toISOString();
    this.sessionId = input.sessionId;
    this.data = input.data ?? {};
  }
}

export interface FlowLoggerContext {
  sessionId: string;
  eventBus: EventEmitter;
  parentEvents: FlowEvent[];
}

type AsyncOriginalMethod<
  TArgs extends unknown[] = unknown[],
  TResult = unknown,
  TThis = unknown,
> = (this: TThis, ...args: TArgs) => Promise<TResult>;

type FlowLoggerLogOptions = FlowEventInput & {
  context?: FlowLoggerContext;
};

const loggerContext = new AsyncLocalStorage<FlowLoggerContext>();

function dataToKb(data: string): string {
  return ((data.length * 0.75) / 1024).toFixed(1);
}

// =============================================================================
// Flow Logger - Main API
// =============================================================================

export class FlowLogger {
  private static cloneContext(ctx: FlowLoggerContext): FlowLoggerContext {
    return {
      ...ctx,
      parentEvents: ctx.parentEvents.map((event) => ({
        ...event,
        eventParentIds: [...event.eventParentIds],
      })),
    };
  }

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

  private static async runWithAutoStatusEventLogging<TResult>(
    options: FlowLoggerLogOptions,
    originalMethod: AsyncOriginalMethod<[], TResult>,
  ): Promise<TResult> {
    const ctx = FlowLogger.currentContext;
    const {
      context: _context,
      data,
      eventParentIds,
      eventType,
      eventIdSuffix,
    } = options;
    let caughtError: unknown = null;

    // if eventParentIds is explicitly [], this is a root event, clear the parent events in context
    if (eventParentIds && eventParentIds.length === 0) {
      ctx.parentEvents = [];
    }

    const startedEvent = FlowLogger.emit({
      eventIdSuffix,
      eventType,
      data,
      eventParentIds,
    });

    ctx.parentEvents.push(startedEvent);

    try {
      return await originalMethod();
    } catch (error) {
      caughtError = error;
      FlowLogger.emit({
        eventIdSuffix,
        eventType: `${eventType}ErrorEvent`,
        eventParentIds: [...startedEvent.eventParentIds, startedEvent.eventId],
        data: {
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - new Date(startedEvent.createdAt).getTime(),
        },
      });
      throw error;
    } finally {
      const parentEvent = ctx.parentEvents.pop();
      if (parentEvent?.eventId === startedEvent.eventId && !caughtError) {
        FlowLogger.emit({
          eventIdSuffix,
          eventType: `${eventType}CompletedEvent`,
          eventParentIds: [
            ...startedEvent.eventParentIds,
            startedEvent.eventId,
          ],
          data: {
            durationMs: Date.now() - new Date(startedEvent.createdAt).getTime(),
          },
        });
      }
    }
  }

  /**
   * Initialize a new logging context. Call this at the start of a session.
   */
  static init(sessionId: string, eventBus: EventEmitter): FlowLoggerContext {
    const ctx: FlowLoggerContext = {
      sessionId,
      eventBus,
      parentEvents: [],
    };

    loggerContext.enterWith(ctx);
    return ctx;
  }

  static async close(context?: FlowLoggerContext | null): Promise<void> {
    const ctx = context ?? loggerContext.getStore() ?? null;
    if (!ctx) return;
    ctx.parentEvents = [];
  }

  static get currentContext(): FlowLoggerContext {
    const ctx = loggerContext.getStore();
    if (!ctx) {
      throw new Error("FlowLogger context is missing.");
    }

    return ctx;
  }

  // decorator method to wrap a class method with automatic started/completed/error events
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
        return await FlowLogger.runWithLogging(
          options,
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

  // closure runner to wrap some async work with automatic started/completed/error events
  static runWithLogging<TMethod extends AsyncOriginalMethod>(
    options: FlowLoggerLogOptions,
    originalMethod: TMethod,
    params: Readonly<Parameters<TMethod>>,
  ): Promise<Awaited<ReturnType<TMethod>>> {
    const eventData = {
      ...(options.data ?? {}),
      params: [...params],
    };

    const execute = (): Promise<Awaited<ReturnType<TMethod>>> =>
      FlowLogger.runWithAutoStatusEventLogging(
        {
          ...options,
          data: eventData,
        },
        () =>
          originalMethod(...params) as Promise<Awaited<ReturnType<TMethod>>>,
      );

    return options.context
      ? loggerContext.run(FlowLogger.cloneContext(options.context), execute)
      : execute();
  }

  // ===========================================================================
  // Agent Events
  // ===========================================================================

  static logAgentScreenshotTakenEvent(data: {
    byteLength: number;
    currentUrl?: string;
    screenshotPath?: string;
  }): void {
    FlowLogger.emit({
      eventIdSuffix: "3",
      eventType: "AgentScreenshotTakenEvent",
      data,
    });
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

  private static logCdpEvent(
    context: FlowLoggerContext,
    eventType: "call" | "response" | "responseError" | "message",
    {
      method,
      params,
      result,
      error,
      targetId,
    }: {
      method: string;
      params?: unknown;
      result?: unknown;
      error?: string;
      targetId?: string | null;
    },
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
        eventIdSuffix: "6",
        eventType:
          eventType === "call"
            ? "CdpCallEvent"
            : eventType === "response"
              ? "CdpResponseEvent"
              : eventType === "responseError"
                ? "CdpResponseErrorEvent"
                : "CdpMessageEvent",
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

  static logLlmRequest({
    requestId,
    model,
    prompt,
  }: {
    requestId: string;
    model: string;
    prompt?: string;
  }): void {
    FlowLogger.emit({
      eventIdSuffix: "7",
      eventType: "LlmRequestEvent",
      data: {
        requestId,
        model,
        prompt,
      },
    });
  }

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
    FlowLogger.emit({
      eventIdSuffix: "7",
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

  /**
   * Create middleware for wrapping language models with LLM call logging.
   * Returns a no-op middleware when logging is disabled.
   */
  static createLlmLoggingMiddleware(
    modelId: string,
  ): Pick<LanguageModelMiddleware, "wrapGenerate"> {
    return {
      wrapGenerate: async ({ doGenerate, params }) => {
        const llmRequestId = uuidv7();
        const toolCount = Array.isArray(params.tools) ? params.tools.length : 0;
        const messages = (params.prompt ?? []) as Array<{
          role?: string;
          content?: unknown;
        }>;
        const lastMsg = messages.filter((m) => m.role !== "system").pop();
        let rolePrefix = lastMsg?.role ?? "?";
        let promptSummary = `(no text) +{${toolCount} tools}`;

        if (lastMsg) {
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
              if (
                toolResult.output?.type === "json" &&
                toolResult.output.value
              ) {
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
                extractLlmMessageSummary({ content: lastMsg.content }) ??
                "(no text)"
              } +{${toolCount} tools}`;
            }
          }

          promptSummary = `${rolePrefix}: ${promptSummary}`;
        } else {
          promptSummary = `?: ${promptSummary}`;
        }

        FlowLogger.logLlmRequest({
          requestId: llmRequestId,
          model: modelId,
          prompt: promptSummary,
        });

        const result = await doGenerate();

        // Extract output summary
        const res = result as {
          text?: string;
          content?: unknown;
          toolCalls?: unknown[];
        };
        let outputSummary = res.text || "";
        if (!outputSummary && res.content) {
          if (typeof res.content === "string") {
            outputSummary = res.content;
          } else if (Array.isArray(res.content)) {
            outputSummary = (
              res.content as Array<{
                type?: string;
                text?: string;
                toolName?: string;
              }>
            )
              .map(
                (c) =>
                  c.text ||
                  (c.type === "tool-call"
                    ? `tool call: ${c.toolName}()`
                    : `[${c.type}]`),
              )
              .join(" ");
          }
        }
        if (!outputSummary && res.toolCalls?.length) {
          outputSummary = `[${res.toolCalls.length} tool calls]`;
        }

        FlowLogger.logLlmResponse({
          requestId: llmRequestId,
          model: modelId,
          output: outputSummary || "[empty]",
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

/** Extract text and image info from a content array (handles nested tool_result) */
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

  let text = result.text;
  if (!text && result.extras.length === 0) return undefined;

  let summary = text || "";
  if (result.extras.length > 0) {
    const extrasStr = result.extras.map((e) => `+{${e}}`).join(" ");
    summary = summary ? `${summary} ${extrasStr}` : extrasStr;
  }
  return summary || undefined;
}

/**
 * Format a prompt summary from LLM messages for logging.
 * Returns format like: "some text +{5.8kb image} +{schema} +{12 tools}"
 */
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

/**
 * Extract a text summary from CUA-style messages.
 * Accepts various message formats (Anthropic, OpenAI, Google).
 */
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

/** Format a CUA response summary for logging */
export function extractLlmCuaResponseSummary(output: unknown): string {
  try {
    // Handle Google format or array
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
