import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import { authMiddleware } from "../../../../lib/auth.js";
import { withErrorHandling } from "../../../../lib/errorHandler.js";
import { error, success } from "../../../../lib/response.js";
import { getSessionStore } from "../../../../lib/sessionStoreManager.js";
import {
  BrowserSessionEndRequestSchema,
  BrowserSessionErrorResponseSchema,
  BrowserSessionHeadersSchema,
  BrowserSessionIdParamsSchema,
  BrowserSessionResponseSchema,
  type BrowserSessionIdParams,
} from "../../../../schemas/v4/browserSession.js";
import { buildBrowserSession } from "../shared.js";

const endBrowserSessionHandler: RouteHandlerMethod = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return error(reply, "Unauthorized", StatusCodes.UNAUTHORIZED);
    }

    const body = (request as { body?: unknown }).body;
    if (body != null) {
      if (typeof body !== "object" || Buffer.isBuffer(body)) {
        return error(
          reply,
          "Request body must be empty",
          StatusCodes.BAD_REQUEST,
        );
      }

      if (Object.keys(body as Record<string, unknown>).length > 0) {
        return error(
          reply,
          "Request body must be empty",
          StatusCodes.BAD_REQUEST,
        );
      }
    }

    const { id } = request.params as BrowserSessionIdParams;
    const sessionStore = getSessionStore();

    if (!(await sessionStore.hasSession(id))) {
      return error(reply, "Browser session not found", StatusCodes.NOT_FOUND);
    }

    const params = await sessionStore.getSessionConfig(id);
    await sessionStore.endSession(id);

    return success(reply, {
      browserSession: buildBrowserSession({
        id,
        params,
        status: "ended",
        available: false,
      }),
    });
  },
);

const endBrowserSessionRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/:id/end",
  schema: {
    operationId: "BrowserSessionEnd",
    summary: "End a browser session",
    headers: BrowserSessionHeadersSchema,
    params: BrowserSessionIdParamsSchema,
    body: BrowserSessionEndRequestSchema,
    response: {
      200: BrowserSessionResponseSchema,
      400: BrowserSessionErrorResponseSchema,
      401: BrowserSessionErrorResponseSchema,
      404: BrowserSessionErrorResponseSchema,
      500: BrowserSessionErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: endBrowserSessionHandler,
};

export default endBrowserSessionRoute;
