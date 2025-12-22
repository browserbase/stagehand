import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import { Api } from "@browserbasehq/stagehand";

import { authMiddleware } from "../../../../lib/auth.js";
import { withErrorHandling } from "../../../../lib/errorHandler.js";
import { error } from "../../../../lib/response.js";

const replayRouteHandler: RouteHandlerMethod = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return error(reply, "Unauthorized", StatusCodes.UNAUTHORIZED);
    }

    return error(reply, "Not implemented", StatusCodes.NOT_IMPLEMENTED);
  },
);

const replayRoute: RouteOptions = {
  method: "GET",
  url: "/sessions/:id/replay",
  schema: {
    ...Api.Operations.SessionReplay,
    hide: true, // Hide from OpenAPI documentation
    headers: Api.SessionHeadersSchema,
    params: Api.SessionIdParamsSchema,
    response: {
      200: Api.ReplayResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: replayRouteHandler,
};

export default replayRoute;
