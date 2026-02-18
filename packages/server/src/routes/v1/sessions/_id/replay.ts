import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import { Api } from "@browserbasehq/stagehand";

import { authMiddleware } from "../../../../lib/auth.js";
import { withErrorHandling } from "../../../../lib/errorHandler.js";
import { error, success } from "../../../../lib/response.js";

const replayRouteHandler: RouteHandlerMethod = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return error(reply, "Unauthorized", StatusCodes.UNAUTHORIZED);
    }

    reply.log.warn("Replay endpoint not implemented for local server.");

    const replay: Api.ReplayResult = {
      pages: [],
    };

    return success(reply, replay);
  },
);

const replayRoute: RouteOptions = {
  method: "GET",
  url: "/sessions/:id/replay",
  schema: {
    ...Api.Operations.SessionReplay,
    headers: Api.SessionHeadersSchema,
    params: Api.SessionIdParamsSchema,
    response: {
      200: Api.ReplayResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: replayRouteHandler,
};

export default replayRoute;
