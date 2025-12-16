import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { Action } from "@browserbasehq/stagehand";
import { z } from "zod/v4";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import {
  ObserveRequestSchema,
  ObserveResultSchema,
  SessionIdParamsSchema,
} from "@browserbasehq/stagehand";

import { authMiddleware } from "../../../../lib/auth.js";
import { AppError, withErrorHandling } from "../../../../lib/errorHandler.js";
import { createStreamingResponse } from "../../../../lib/stream.js";
import { getSessionStore } from "../../../../lib/sessionStoreManager.js";

interface ObserveParams {
  id: string;
}

const observeRouteHandler: RouteHandlerMethod = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return reply
        .status(StatusCodes.UNAUTHORIZED)
        .send({ error: "Unauthorized" });
    }

    const { id } = request.params as ObserveParams;

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

    return createStreamingResponse<z.infer<typeof ObserveRequestSchema>>({
      sessionId: id,
      request,
      reply,
      schema: ObserveRequestSchema,
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
    params: SessionIdParamsSchema,
    body: ObserveRequestSchema,
    response: {
      200: z
        .object({
          success: z.literal(true),
          data: ObserveResultSchema,
        })
        .strict(),
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: observeRouteHandler,
};

export default observeRoute;
