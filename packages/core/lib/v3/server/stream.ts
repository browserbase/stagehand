import type { FastifyReply, FastifyRequest } from "fastify";
import { randomUUID } from "crypto";
import type { V3 } from "../v3";
import type { SessionManager } from "./sessions";

export interface StreamingHandlerResult {
  result: unknown;
}

export interface StreamingHandlerContext {
  stagehand: V3;
  sessionId: string;
  request: FastifyRequest;
}

export interface StreamingResponseOptions<T> {
  sessionId: string;
  sessionManager: SessionManager;
  request: FastifyRequest;
  reply: FastifyReply;
  handler: (ctx: StreamingHandlerContext, data: T) => Promise<StreamingHandlerResult>;
}

/**
 * Sends an SSE (Server-Sent Events) message to the client
 */
function sendSSE(reply: FastifyReply, data: object): void {
  const message = {
    id: randomUUID(),
    ...data,
  };
  reply.raw.write(`data: ${JSON.stringify(message)}\n\n`);
}

/**
 * Creates a streaming response handler that sends events via SSE
 * Ported from cloud API but without DB/LaunchDarkly dependencies
 */
export async function createStreamingResponse<T>({
  sessionId,
  sessionManager,
  request,
  reply,
  handler,
}: StreamingResponseOptions<T>): Promise<void> {
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

    sendSSE(reply, {
      type: "system",
      data: { status: "starting" },
    });
  }

  let result: StreamingHandlerResult | null = null;
  let handlerError: Error | null = null;

  try {
    // Get or create the Stagehand instance with dynamic logger
    const stagehand = await sessionManager.getStagehand(
      sessionId,
      shouldStream
        ? (message) => {
            sendSSE(reply, {
              type: "log",
              data: {
                status: "running",
                message,
              },
            });
          }
        : undefined,
    );

    if (shouldStream) {
      sendSSE(reply, {
        type: "system",
        data: { status: "connected" },
      });
    }

    // Execute the handler
    const ctx: StreamingHandlerContext = {
      stagehand,
      sessionId,
      request,
    };

    result = await handler(ctx, data);
  } catch (err) {
    handlerError = err instanceof Error ? err : new Error("Unknown error occurred");
  }

  // Handle error case
  if (handlerError) {
    const errorMessage = handlerError.message || "An unexpected error occurred";

    if (shouldStream) {
      sendSSE(reply, {
        type: "system",
        data: {
          status: "error",
          error: errorMessage,
        },
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
    sendSSE(reply, {
      type: "system",
      data: {
        status: "finished",
        result: result?.result,
      },
    });
    reply.raw.end();
  } else {
    reply.status(200).send({
      result: result?.result,
    });
  }
}
