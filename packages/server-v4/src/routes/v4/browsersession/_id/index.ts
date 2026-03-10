import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import { authMiddleware } from "../../../../lib/auth.js";
import { withErrorHandling } from "../../../../lib/errorHandler.js";
import { error, success } from "../../../../lib/response.js";
import { getSessionStore } from "../../../../lib/sessionStoreManager.js";
import {
  BrowserSessionErrorResponseSchema,
  BrowserSessionHeadersSchema,
  BrowserSessionIdParamsSchema,
  BrowserSessionResponseSchema,
  type BrowserSessionIdParams,
} from "../../../../schemas/v4/browserSession.js";
import { buildBrowserSession } from "../shared.js";

const getBrowserSessionHandler: RouteHandlerMethod = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return error(reply, "Unauthorized", StatusCodes.UNAUTHORIZED);
    }

    const { id } = request.params as BrowserSessionIdParams;
    const sessionStore = getSessionStore();

    if (!(await sessionStore.hasSession(id))) {
      return error(reply, "Browser session not found", StatusCodes.NOT_FOUND);
    }

    const params = await sessionStore.getSessionConfig(id);

    return success(reply, {
      browserSession: buildBrowserSession({
        id,
        params,
        status: "running",
        available: true,
      }),
    });
  },
);

const getBrowserSessionRoute: RouteOptions = {
  method: "GET",
  url: "/browsersession/:id",
  schema: {
    operationId: "BrowserSessionStatus",
    summary: "Get browser session status",
    headers: BrowserSessionHeadersSchema,
    params: BrowserSessionIdParamsSchema,
    response: {
      200: BrowserSessionResponseSchema,
      401: BrowserSessionErrorResponseSchema,
      404: BrowserSessionErrorResponseSchema,
      500: BrowserSessionErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: getBrowserSessionHandler,
};

export default getBrowserSessionRoute;
