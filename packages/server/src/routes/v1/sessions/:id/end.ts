import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import {
  SessionIdParamsSchema,
  SessionEndResponseSchema,
} from "@browserbasehq/stagehand";

import { authMiddleware } from "../../../../lib/auth.js";
import { withErrorHandling } from "../../../../lib/errorHandler.js";
import { error, success } from "../../../../lib/response.js";
import { getSessionStore } from "../../../../lib/sessionStoreManager.js";

interface EndParams {
  id: string;
}

const endRouteHandler: RouteHandlerMethod = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return error(reply, "Unauthorized", StatusCodes.UNAUTHORIZED);
    }

    const { id: sessionId } = request.params as EndParams;
    const sessionStore = getSessionStore();
    await sessionStore.endSession(sessionId);

    return success(reply, {});
  },
);

const endRoute: RouteOptions = {
  method: "POST",
  url: "/sessions/:id/end",
  schema: {
    params: SessionIdParamsSchema,
    response: {
      200: SessionEndResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: endRouteHandler,
};

export default endRoute;
