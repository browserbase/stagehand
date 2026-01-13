import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import { Api } from "@browserbasehq/stagehand";

import { authMiddleware } from "../../../../lib/auth.js";
import { withErrorHandling } from "../../../../lib/errorHandler.js";
import { error } from "../../../../lib/response.js";
import { getSessionStore } from "../../../../lib/sessionStoreManager.js";

const endRouteHandler: RouteHandlerMethod = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return error(reply, "Unauthorized", StatusCodes.UNAUTHORIZED);
    }

    const { id: sessionId } = request.params as Api.SessionIdParams;
    const sessionStore = getSessionStore();
    await sessionStore.endSession(sessionId);

    return reply.status(StatusCodes.OK).send({ success: true });
  },
);

const endRoute: RouteOptions = {
  method: "POST",
  url: "/sessions/:id/end",
  schema: {
    ...Api.Operations.SessionEnd,
    headers: Api.SessionHeadersSchema,
    params: Api.SessionIdParamsSchema,
    body: Api.SessionEndRequestSchema,
    response: {
      200: Api.SessionEndResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: endRouteHandler,
};

export default endRoute;
