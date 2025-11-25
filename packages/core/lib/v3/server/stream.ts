import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "crypto";
import type { V3 } from "../v3";
import type { SessionManager } from "./sessions";
import type { StagehandEventBus } from "../eventBus";
import type {
  StagehandActionStartedEvent,
  StagehandActionCompletedEvent,
  StagehandActionErroredEvent,
  StagehandStreamStartedEvent,
  StagehandStreamMessageSentEvent,
  StagehandStreamEndedEvent,
  StagehandActionProgressEvent,
} from "./events";

export interface StreamingHandlerResult {
  result: unknown;
}

export interface StreamingHandlerContext {
  stagehand: V3;
  sessionId: string;
  requestId: string;
  request: FastifyRequest;
  actionType: "act" | "extract" | "observe" | "agentExecute" | "navigate";
  eventBus: StagehandEventBus;
}

export interface StreamingResponseOptions<T> {
  sessionId: string;
  requestId: string;
  actionType: "act" | "extract" | "observe" | "agentExecute" | "navigate";
  sessionManager: SessionManager;
  request: FastifyRequest;
  reply: FastifyReply;
  eventBus: StagehandEventBus;
  handler: (ctx: StreamingHandlerContext, data: T) => Promise<StreamingHandlerResult>;
}

/**
 * Sends an SSE (Server-Sent Events) message to the client
 */
async function sendSSE(
  reply: FastifyReply,
  data: object,
  eventBus: StagehandEventBus,
  sessionId: string,
  requestId: string,
): Promise<void> {
  const message = {
    id: randomUUID(),
    ...data,
  };
  reply.raw.write(`data: ${JSON.stringify(message)}\n\n`);

  // Emit stream message event
  await eventBus.emitAsync("StagehandStreamMessageSent", {
    type: "StagehandStreamMessageSent",
    timestamp: new Date(),
    sessionId,
    requestId,
    messageType: (data as any).type || "unknown",
    data: (data as any).data,
  });
}

/**
 * Creates a streaming response handler that sends events via SSE
 * Ported from cloud API but without DB/LaunchDarkly dependencies
 */
export async function createStreamingResponse<T>({
  sessionId,
  requestId,
  actionType,
  sessionManager,
  request,
  reply,
  eventBus,
  handler,
}: StreamingResponseOptions<T>): Promise<void> {
  const startTime = Date.now();

  // Check if streaming is requested
  const streamHeader = request.headers["x-stream-response"];
  const shouldStream = streamHeader === "true";

  // Parse the request body
  const data = request.body as T;

  // Set up SSE response if streaming
  if (shouldStream) {
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "Transfer-Encoding": "chunked",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Credentials": "true",
    });

    // Emit stream started event
    await eventBus.emitAsync("StagehandStreamStarted", {
      type: "StagehandStreamStarted",
      timestamp: new Date(),
      sessionId,
      requestId,
    });

    await sendSSE(
      reply,
      {
        type: "system",
        data: { status: "starting" },
      },
      eventBus,
      sessionId,
      requestId,
    );
  }

  let result: StreamingHandlerResult | null = null;
  let handlerError: Error | null = null;
  let actionId: string | undefined = undefined;

  try {
    // Get or create the Stagehand instance with dynamic logger
    const stagehand = await sessionManager.getStagehand(
      sessionId,
      shouldStream
        ? async (message) => {
            await sendSSE(
              reply,
              {
                type: "log",
                data: {
                  status: "running",
                  message,
                },
              },
              eventBus,
              sessionId,
              requestId,
            );

            // Emit action progress event
            await eventBus.emitAsync("StagehandActionProgress", {
              type: "StagehandActionProgress",
              timestamp: new Date(),
              sessionId,
              requestId,
              actionId,
              actionType,
              message,
            });
          }
        : undefined,
    );

    if (shouldStream) {
      await sendSSE(
        reply,
        {
          type: "system",
          data: { status: "connected" },
        },
        eventBus,
        sessionId,
        requestId,
      );
    }

    // Emit action started event
    const page = await stagehand.context.awaitActivePage();
    const actionStartedEvent: StagehandActionStartedEvent = {
      type: "StagehandActionStarted",
      timestamp: new Date(),
      sessionId,
      requestId,
      actionType,
      input: (data as any).input || (data as any).instruction || (data as any).url || "",
      options: (data as any).options || {},
      url: page?.url() || "",
      frameId: (data as any).frameId,
    };
    await eventBus.emitAsync("StagehandActionStarted", actionStartedEvent);
    // Cloud listeners can set actionId on the event
    actionId = actionStartedEvent.actionId;

    // Execute the handler
    const ctx: StreamingHandlerContext = {
      stagehand,
      sessionId,
      requestId,
      request,
      actionType,
      eventBus,
    };

    result = await handler(ctx, data);

    // Emit action completed event
    await eventBus.emitAsync("StagehandActionCompleted", {
      type: "StagehandActionCompleted",
      timestamp: new Date(),
      sessionId,
      requestId,
      actionId,
      actionType,
      result: result?.result,
      metrics: (stagehand as any).metrics
        ? {
            promptTokens: (stagehand as any).metrics.totalPromptTokens || 0,
            completionTokens: (stagehand as any).metrics.totalCompletionTokens || 0,
            inferenceTimeMs: 0,
          }
        : undefined,
      durationMs: Date.now() - startTime,
    });
  } catch (err) {
    handlerError = err instanceof Error ? err : new Error("Unknown error occurred");

    // Emit action error event
    await eventBus.emitAsync("StagehandActionErrored", {
      type: "StagehandActionErrored",
      timestamp: new Date(),
      sessionId,
      requestId,
      actionId,
      actionType,
      error: {
        message: handlerError.message,
        stack: handlerError.stack,
      },
      durationMs: Date.now() - startTime,
    });
  }

  // Handle error case
  if (handlerError) {
    const errorMessage = handlerError.message || "An unexpected error occurred";

    if (shouldStream) {
      await sendSSE(
        reply,
        {
          type: "system",
          data: {
            status: "error",
            error: errorMessage,
          },
        },
        eventBus,
        sessionId,
        requestId,
      );

      // Emit stream ended event
      await eventBus.emitAsync("StagehandStreamEnded", {
        type: "StagehandStreamEnded",
        timestamp: new Date(),
        sessionId,
        requestId,
      });

      reply.raw.end();
    } else {
      reply.status(500).send({
        error: errorMessage,
      });
    }
    return;
  }

  // Handle success case
  if (shouldStream) {
    await sendSSE(
      reply,
      {
        type: "system",
        data: {
          status: "finished",
          result: result?.result,
        },
      },
      eventBus,
      sessionId,
      requestId,
    );

    // Emit stream ended event
    await eventBus.emitAsync("StagehandStreamEnded", {
      type: "StagehandStreamEnded",
      timestamp: new Date(),
      sessionId,
      requestId,
    });

    reply.raw.end();
  } else {
    reply.status(200).send({
      result: result?.result,
    });
  }
}
