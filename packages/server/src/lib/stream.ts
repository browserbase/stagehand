import type { FastifyReply, FastifyRequest } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { Stagehand as V3Stagehand, StagehandMetrics } from "stagehand-v3";
import { v4 } from "uuid";
import { z } from "zod/v3";

import {
  updateActionEndTime,
  updateActionStartAndEndTime,
} from "./db/actions.js";
import { createInference } from "./db/inference.js";
import { AppError } from "./errorHandler.js";
import { dangerouslyGetHeader } from "./header.js";
import { error, success } from "./response.js";
import { resumeStagehandSession } from "./session.js";

interface StreamingResponseOptions<TV3> {
  browserbaseSessionId: string;
  request: FastifyRequest;
  reply: FastifyReply;
  schema: z.ZodType<TV3>;
  handler: (stagehand: {
    stagehand: V3Stagehand;
    data: TV3;
  }) => Promise<{ result: unknown; actionId?: string }>;
  stagehandMethod?: "act" | "extract" | "observe";
}

export async function createStreamingResponse<TV3>({
  browserbaseSessionId,
  request,
  reply,
  schema,
  handler,
  stagehandMethod,
}: StreamingResponseOptions<TV3>) {
  const streamHeader = dangerouslyGetHeader(
    request,
    "x-stream-response",
  ).toLowerCase();

  if (streamHeader !== "true" && streamHeader !== "false") {
    return error(
      reply,
      "Invalid value for x-stream-response header",
      StatusCodes.BAD_REQUEST,
    );
  }

  const shouldStreamResponse = streamHeader === "true";
  const browserbaseApiKey = dangerouslyGetHeader(request, "x-bb-api-key");
  const browserbaseProjectId = request.headers["x-bb-project-id"];
  const modelApiKey = dangerouslyGetHeader(request, "x-model-api-key");
  const sentAt = request.headers["x-sent-at"];

  if (!browserbaseApiKey) {
    return reply.status(StatusCodes.BAD_REQUEST).send({
      error:
        "Browserbase API key is required as a `browserbase-api-key` header",
    });
  } else if (!browserbaseProjectId) {
    return reply.status(StatusCodes.BAD_REQUEST).send({
      error:
        "Browserbase project ID is required as a `browserbase-project-id` header",
    });
  }

  // Parse data using V3 schema
  let parsedData: TV3;

  try {
    const json: unknown = request.body;
    parsedData = await schema.parseAsync(json);
  } catch (err) {
    const error = err as Error | z.ZodError;

    if (error instanceof z.ZodError) {
      return reply.status(StatusCodes.BAD_REQUEST).send({
        error: error.issues.map((e) => ({
          path: e.path[0],
          message: e.message,
        })),
      });
    }

    return reply.status(StatusCodes.BAD_REQUEST).send({ error: error.message });
  }

  if (shouldStreamResponse) {
    try {
      reply.raw.writeHead(StatusCodes.OK, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Transfer-Encoding": "chunked",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "*",
        "Access-Control-Allow-Credentials": "true",
      });
    } catch (err) {
      return error(
        reply,
        "Failed to write head",
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }
  }

  function sendData(data: object) {
    if (!shouldStreamResponse) {
      return;
    }

    const message = {
      id: v4(),
      ...data,
    };

    reply.raw.write(`data: ${JSON.stringify(message)}\n\n`);
  }

  sendData({
    type: "system",
    data: {
      status: "starting",
    },
  });

  async function getStagehand() {
    const stagehand = await resumeStagehandSession({
      sessionId: browserbaseSessionId,
      modelApiKey,
      browserbaseApiKey,
      useV3: true,
      logger: (message) => {
        sendData({
          type: "log",
          data: {
            status: "running",
            message,
          },
        });
      },
      requestLogger: request.log,
    });

    sendData({
      type: "system",
      data: {
        status: "connected",
      },
    });

    return stagehand as V3Stagehand;
  }

  const stagehand = await getStagehand();

  const originalMetrics = structuredClone(await stagehand.metrics);

  let result: Awaited<ReturnType<typeof handler>> | null = null;
  let handlerError: Error | null = null;

  try {
    result = await handler({ stagehand, data: parsedData });
  } catch (err) {
    handlerError =
      err instanceof Error ? err : new Error("Unknown error occurred");
  } finally {
    // Always track metrics and timing, even on error
    if (
      stagehandMethod &&
      ["act", "extract", "observe"].includes(stagehandMethod) &&
      result?.actionId
    ) {
      const currentMetrics = await stagehand.metrics;

      const metricsDelta: Pick<
        StagehandMetrics,
        "totalPromptTokens" | "totalCompletionTokens" | "totalInferenceTimeMs"
      > = {
        totalPromptTokens:
          currentMetrics.totalPromptTokens - originalMetrics.totalPromptTokens,
        totalCompletionTokens:
          currentMetrics.totalCompletionTokens -
          originalMetrics.totalCompletionTokens,
        totalInferenceTimeMs:
          currentMetrics.totalInferenceTimeMs -
          originalMetrics.totalInferenceTimeMs,
      };

      await createInference(result.actionId, metricsDelta);
    }

    if (result?.actionId && sentAt) {
      if (sentAt) {
        await updateActionStartAndEndTime(
          result.actionId,
          // handle timestamp or ISO string
          // from the stagehand SDK, it should always be an ISO string
          new Date(typeof sentAt === "string" ? sentAt : sentAt.toString()),
          new Date(),
        );
      } else {
        // x-sent-at should always be present for streamed responses,
        // but if it's not, we can use fall back to the creation time
        // at insertion
        await updateActionEndTime(result.actionId, new Date());
      }
    }
  }

  // Handle error case
  if (handlerError) {
    // Get client-safe error message
    const clientMessage =
      handlerError instanceof AppError
        ? handlerError.getClientMessage()
        : "An unexpected error occurred";

    sendData({
      type: "system",
      data: {
        status: "error",
        error: clientMessage,
      },
    });

    if (shouldStreamResponse) {
      reply.raw.end();
      return reply;
    }

    const statusCode =
      handlerError instanceof AppError
        ? handlerError.statusCode
        : StatusCodes.INTERNAL_SERVER_ERROR;
    return error(reply, clientMessage, statusCode);
  }

  // Handle success case
  sendData({
    type: "system",
    data: {
      status: "finished",
      result: result?.result,
    },
  });

  if (shouldStreamResponse) {
    reply.raw.end();
    return reply;
  }

  return success(reply, result);
}
