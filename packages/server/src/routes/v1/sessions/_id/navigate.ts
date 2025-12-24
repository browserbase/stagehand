import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import { Api } from "@browserbasehq/stagehand";

import { authMiddleware } from "../../../../lib/auth.js";
import { AppError, withErrorHandling } from "../../../../lib/errorHandler.js";
import { createStreamingResponse } from "../../../../lib/stream.js";
import { getSessionStore } from "../../../../lib/sessionStoreManager.js";

const navigateRouteHandler: RouteHandlerMethod = withErrorHandling(
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

    return createStreamingResponse<Api.NavigateRequest>({
      sessionId: id,
      request,
      reply,
      schema: Api.NavigateRequestSchema,
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
    ...Api.Operations.SessionNavigate,
    headers: Api.SessionHeadersSchema,
    params: Api.SessionIdParamsSchema,
    body: Api.NavigateRequestSchema,
    response: {
      200: Api.NavigateResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: navigateRouteHandler,
};

export default navigateRoute;
