import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { Action } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import { Api } from "@browserbasehq/stagehand";

import { authMiddleware } from "../../../../lib/auth.js";
import { AppError, withErrorHandling } from "../../../../lib/errorHandler.js";
import { createStreamingResponse } from "../../../../lib/stream.js";
import { getSessionStore } from "../../../../lib/sessionStoreManager.js";

const observeRouteHandler: RouteHandlerMethod = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return reply
        .status(StatusCodes.UNAUTHORIZED)
        .send({ error: "Unauthorized" });
    }

    const { id } = request.params as Api.SessionIdParams;

    if (!id.length) {
      return reply.status(StatusCodes.BAD_REQUEST).send({
        message: "Missing session id",
      });
    }

    const sessionStore = getSessionStore();
    const hasSession = await sessionStore.hasSession(id);
    if (!hasSession) {
      return reply.status(StatusCodes.NOT_FOUND).send({
        message: "Session not found",
      });
    }

    return createStreamingResponse<Api.ObserveRequest>({
      sessionId: id,
      request,
      reply,
      schema: Api.ObserveRequestSchema,
      handler: async ({ stagehand, data }) => {
        const { frameId } = data;
        const page = frameId
          ? stagehand.context.resolvePageByMainFrameId(frameId)
          : await stagehand.context.awaitActivePage();

        if (!page) {
          throw new AppError(
            "Page not found",
            StatusCodes.INTERNAL_SERVER_ERROR,
          );
        }

        const safeOptions = {
          ...data.options,
          model:
            typeof data.options?.model === "string"
              ? { modelName: data.options.model }
              : data.options?.model
                ? {
                    ...data.options.model,
                    modelName: data.options.model.modelName ?? "gpt-4o",
                  }
                : undefined,
          page,
        };

        let result: Action[];

        if (data.instruction) {
          result = await stagehand.observe(data.instruction, safeOptions);
        } else {
          result = await stagehand.observe(safeOptions);
        }

        return { result };
      },
      operation: "observe",
    });
  },
);

const observeRoute: RouteOptions = {
  method: "POST",
  url: "/sessions/:id/observe",
  schema: {
    ...Api.Operations.SessionObserve,
    headers: Api.SessionHeadersSchema,
    params: Api.SessionIdParamsSchema,
    body: Api.ObserveRequestSchema,
    response: {
      200: Api.ObserveResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: observeRouteHandler,
};

export default observeRoute;
