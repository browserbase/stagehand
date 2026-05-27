import type { FastifyReply, FastifyRequest } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { Stagehand as V3Stagehand } from "@browserbasehq/stagehand";
import { v4 } from "uuid";
import { z } from "zod/v4";

import { AppError } from "./errorHandler.js";
import {
  getOptionalHeader,
  getRequestModelConfig,
  getStagehandInitModelConfig,
  shouldRespondWithSSE,
  type RequestModelConfig,
} from "./header.js";
import { error, success } from "./response.js";
import { getSessionStore } from "./sessionStoreManager.js";
import type { RequestContext } from "./SessionStore.js";

interface StreamingResponseOptions<TV3> {
  sessionId: string;
  request: FastifyRequest;
  reply: FastifyReply;
  schema: z.ZodType<TV3>;
  handler: (ctx: {
    stagehand: V3Stagehand;
    data: TV3;
  }) => Promise<{ result: unknown; actionId?: string }>;
  operation?: string;
}

type StreamEventName =
  | "starting"
  | "connected"
  | "running"
  | "finished"
  | "error";
type StreamPayloadType = "system" | "log";

function formatZodIssues(err: z.ZodError) {
  return err.issues.map((issue) => ({
    path: issue.path[0] ?? "unknown",
    message: issue.message,
  }));
}

export async function createStreamingResponse<TV3>({
  sessionId,
  request,
  reply,
  schema,
  handler,
  operation,
}: StreamingResponseOptions<TV3>) {
  const shouldStreamResponse = shouldRespondWithSSE(request);

  const sessionStore = getSessionStore();
  const sessionConfig = await sessionStore.getSessionConfig(sessionId);
  const browserType = sessionConfig.browserType ?? "local";

  let browserbaseApiKey = sessionConfig.browserbaseApiKey;
  const browserbaseProjectId = sessionConfig.browserbaseProjectId;

  if (browserType === "browserbase") {
    browserbaseApiKey =
      browserbaseApiKey ?? getOptionalHeader(request, "x-bb-api-key");

    if (!browserbaseApiKey || !browserbaseProjectId) {
      return reply.status(StatusCodes.BAD_REQUEST).send({
        error:
          "Browserbase API key and resolved project ID are required for browserbase sessions",
      });
    }
  }

  // Parse data using V3 schema
  let parsedData: TV3;

  try {
    const json: unknown = request.body;
    parsedData = await schema.parseAsync(json);
  } catch (err) {
    const parseError = err as Error | z.ZodError;

    if (parseError instanceof z.ZodError) {
      return reply.status(StatusCodes.BAD_REQUEST).send({
        error: parseError.issues.map((issue) => ({
          path: issue.path[0],
          message: issue.message,
        })),
      });
    }

    return reply
      .status(StatusCodes.BAD_REQUEST)
      .send({ error: parseError.message });
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
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (_err) {
      return error(
        reply,
        "Failed to write head",
        StatusCodes.INTERNAL_SERVER_ERROR,
      );
    }
  }

  const sendData = (
    event: StreamEventName,
    type: StreamPayloadType,
    data: object,
  ) => {
    if (!shouldStreamResponse) {
      return;
    }

    reply.raw.write(
      `event: ${event}\ndata: ${JSON.stringify({ data, type, id: v4() })}\n\n`,
    );
  };

  const actionId = v4();

  sendData("starting", "system", { status: "starting" });
  const sendZodValidationError = (err: z.ZodError) => {
    const validationIssues = formatZodIssues(err);
    if (shouldStreamResponse) {
      sendData("error", "system", {
        status: "error",
        error: validationIssues,
      });
      reply.raw.end();
      return reply;
    }

    return reply.status(StatusCodes.BAD_REQUEST).send({
      error: validationIssues,
    });
  };

  const requestModelConfigResult = getRequestModelConfig(request);
  if (requestModelConfigResult.success === false) {
    return sendZodValidationError(requestModelConfigResult.error);
  }

  const requestModelConfig: RequestModelConfig = requestModelConfigResult.data;
  const stagehandInitModelConfigResult = getStagehandInitModelConfig(
    request,
    requestModelConfig,
  );
  if (stagehandInitModelConfigResult.success === false) {
    return sendZodValidationError(stagehandInitModelConfigResult.error);
  }

  const stagehandInitModelConfig = stagehandInitModelConfigResult.data;
  const modelApiKey = requestModelConfig.apiKey;
  const parsedRequestModelConfig = stagehandInitModelConfig.model?.modelName
    ? stagehandInitModelConfig.model
    : undefined;

  const requestContext: RequestContext = {
    modelApiKey,
    requestModelConfig: parsedRequestModelConfig,
    logger: shouldStreamResponse
      ? (message) => {
          sendData("running", "log", { status: "running", message });
        }
      : undefined,
  };

  let stagehand: V3Stagehand;
  try {
    stagehand = (await sessionStore.getOrCreateStagehand(
      sessionId,
      requestContext,
    )) as V3Stagehand;
  } catch (err) {
    const loadError = err instanceof Error ? err : new Error(String(err));

    sendData("error", "system", { status: "error", error: loadError.message });

    if (shouldStreamResponse) {
      reply.raw.end();
      return reply;
    }

    return error(
      reply,
      loadError.message,
      loadError instanceof AppError
        ? loadError.statusCode
        : StatusCodes.INTERNAL_SERVER_ERROR,
    );
  }

  sendData("connected", "system", { status: "connected" });

  let result: Awaited<ReturnType<typeof handler>> | null = null;
  let handlerError: Error | null = null;

  try {
    result = await handler({ stagehand, data: parsedData });
  } catch (err) {
    handlerError = err instanceof Error ? err : new Error("Unknown error");
    request.log.error(
      {
        err: handlerError,
        operation: operation ?? "operation",
        sessionId,
        browserType,
        modelName: requestModelConfig.modelName,
        hasModelApiKey: Boolean(modelApiKey),
        hasBrowserbaseApiKey: Boolean(browserbaseApiKey),
        hasBrowserbaseProjectId: Boolean(browserbaseProjectId),
      },
      "operation handler failed",
    );
  }

  if (handlerError) {
    const clientMessage =
      handlerError instanceof AppError
        ? handlerError.getClientMessage()
        : handlerError.message;

    sendData("error", "system", { status: "error", error: clientMessage });

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

  sendData("finished", "system", {
    status: "finished",
    result: result?.result,
    actionId,
  });

  if (shouldStreamResponse) {
    reply.raw.end();
    return reply;
  }

  return success(reply, { result: result?.result, actionId });
}
