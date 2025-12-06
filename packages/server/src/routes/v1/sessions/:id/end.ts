import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";

import { authMiddleware } from "../../../../lib/auth.js";
import { withErrorHandling } from "../../../../lib/errorHandler.js";
import { dangerouslyGetHeader } from "../../../../lib/header.js";
import { error, success } from "../../../../lib/response.js";
import { endSession } from "../../../../lib/session.js";

interface EndParams {
  id: string;
}

const endRouteHandler: RouteHandlerMethod = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return error(reply, "Unauthorized", StatusCodes.UNAUTHORIZED);
    }

    const { id: sessionId } = request.params as EndParams;
    const browserbaseApiKey = dangerouslyGetHeader(request, "x-bb-api-key");
    await endSession(sessionId, browserbaseApiKey);

    return success(reply);
  },
);

const endRoute: RouteOptions = {
  method: "POST",
  url: "/sessions/:id/end",
  handler: endRouteHandler,
};

export default endRoute;
