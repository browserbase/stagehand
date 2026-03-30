import type { FastifyRequest, RouteHandlerMethod } from "fastify";
import {
  FlowLogger,
  type Stagehand as V3Stagehand,
} from "@browserbasehq/stagehand";
import { StatusCodes } from "http-status-codes";

import { getOptionalHeader } from "../../../lib/header.js";
import { AppError } from "../../../lib/errorHandler.js";
import { success } from "../../../lib/response.js";
import { getSessionStore } from "../../../lib/sessionStoreManager.js";
import type { RequestContext } from "../../../lib/SessionStore.js";
import { StagehandErrorResponseSchema } from "../../../schemas/v4/stagehand.js";

export const stagehandErrorResponses = {
  400: StagehandErrorResponseSchema,
  401: StagehandErrorResponseSchema,
  404: StagehandErrorResponseSchema,
  408: StagehandErrorResponseSchema,
  422: StagehandErrorResponseSchema,
  500: StagehandErrorResponseSchema,
};

type StagehandRequestBody<TParams> = {
  id?: string;
  sessionId: string;
} & TParams;

type StagehandHandlerContext<TParams> = {
  params: TParams;
  request: FastifyRequest;
  sessionId: string;
  stagehand: V3Stagehand;
};

function getStagehandModelApiKey<TParams>(
  request: FastifyRequest,
  params: TParams,
): string | undefined {
  if (typeof params === "object" && params !== null && "options" in params) {
    const options = (params as { options?: unknown }).options;
    if (typeof options === "object" && options !== null && "model" in options) {
      const model = (options as { model?: unknown }).model;
      if (
        typeof model === "object" &&
        model !== null &&
        "apiKey" in model &&
        typeof (model as { apiKey?: unknown }).apiKey === "string"
      ) {
        return (model as { apiKey: string }).apiKey;
      }
    }
  }

  return getOptionalHeader(request, "x-model-api-key");
}

export function normalizeStagehandModel(
  model: unknown,
): Record<string, unknown> | undefined {
  if (typeof model === "string") {
    return { modelName: model };
  }

  if (typeof model !== "object" || model === null) {
    return undefined;
  }

  const normalized = { ...(model as Record<string, unknown>) };
  if (
    typeof normalized.modelName !== "string" ||
    normalized.modelName.length === 0
  ) {
    normalized.modelName = "gpt-4o";
  }

  return normalized;
}

export async function resolveStagehandPage(
  stagehand: V3Stagehand,
  frameId?: string | null,
) {
  const page = frameId
    ? stagehand.context.resolvePageByMainFrameId(frameId)
    : await stagehand.context.awaitActivePage();

  if (!page) {
    throw new AppError("Page not found", StatusCodes.NOT_FOUND);
  }

  return page;
}

export function createStagehandRouteHandler<TParams>({
  execute,
  eventType,
}: {
  execute: (ctx: StagehandHandlerContext<TParams>) => Promise<unknown>;
  eventType: string;
}): RouteHandlerMethod {
  return async (request, reply) => {
    const input = request.body as StagehandRequestBody<TParams>;
    const { id: _id, sessionId, ...rawParams } = input;
    const params = rawParams as TParams;
    const requestContext: RequestContext = {
      modelApiKey: getStagehandModelApiKey(request, params),
    };
    const stagehand = await getSessionStore().getOrCreateStagehand(
      sessionId,
      requestContext,
    );

    let eventId = "";
    const result = await FlowLogger.runWithLogging(
      {
        context: stagehand.flowLoggerContext,
        eventType,
        eventIdSuffix: "1",
        eventParentIds: [],
      },
      async (loggedParams: TParams) => {
        eventId = FlowLogger.currentContext.parentEvents.at(-1)?.eventId ?? "";
        return await execute({
          params: loggedParams,
          request,
          sessionId,
          stagehand,
        });
      },
      [params],
    );

    return success(reply, { result, eventId });
  };
}
