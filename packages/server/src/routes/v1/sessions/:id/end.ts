import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import { z } from "zod/v4";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

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
    params: z.object({ id: z.string() }).strict(),
    response: {
      200: z
        .object({
          success: z.literal(true),
          data: z.object({}).strict(),
        })
        .strict(),
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: endRouteHandler,
};

export default endRoute;
