import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import { z } from "zod/v4";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import {
  NavigateRequestSchema,
  NavigateResultSchema,
  SessionIdParamsSchema,
} from "@browserbasehq/stagehand";

import { authMiddleware } from "../../../../lib/auth.js";
import { AppError, withErrorHandling } from "../../../../lib/errorHandler.js";
import { createStreamingResponse } from "../../../../lib/stream.js";
import { getSessionStore } from "../../../../lib/sessionStoreManager.js";

interface NavigateParams {
  id: string;
}

const navigateRouteHandler: RouteHandlerMethod = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return reply
        .status(StatusCodes.UNAUTHORIZED)
        .send({ error: "Unauthorized" });
    }

    const { id } = request.params as NavigateParams;

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

    return createStreamingResponse<z.infer<typeof NavigateRequestSchema>>({
      sessionId: id,
      request,
      reply,
      schema: NavigateRequestSchema,
      handler: async ({ stagehand, data }) => {
        const page = data.frameId
          ? stagehand.context.resolvePageByMainFrameId(data.frameId)
          : await stagehand.context.awaitActivePage();

        if (!page) {
          throw new AppError("Page not found", StatusCodes.NOT_FOUND);
        }

        const result = await page.goto(data.url, data.options);

        return { result };
      },
      operation: "navigate",
    });
  },
);

const navigateRoute: RouteOptions = {
  method: "POST",
  url: "/sessions/:id/navigate",
  schema: {
    params: SessionIdParamsSchema,
    body: NavigateRequestSchema,
    response: {
      200: z
        .object({
          success: z.literal(true),
          data: NavigateResultSchema,
        })
        .strict(),
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: navigateRouteHandler,
};

export default navigateRoute;
