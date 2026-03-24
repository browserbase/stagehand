import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionEndRequestSchema,
  BrowserSessionHeadersSchema,
  BrowserSessionIdParamsSchema,
  BrowserSessionResponseSchema,
  BrowserSessionV4ErrorResponseSchema,
  type BrowserSessionIdParams,
} from "../../../../schemas/v4/browserSession.js";
import { endBrowserSession } from "../../stubState.js";

const endBrowserSessionHandler: RouteHandlerMethod = async (request, reply) => {
  const { id } = request.params as BrowserSessionIdParams;
  const browserSession = endBrowserSession(id);

  return reply.status(StatusCodes.OK).send(
    BrowserSessionResponseSchema.parse({
      success: true,
      data: {
        browserSession,
      },
    }),
  );
};

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
      404: BrowserSessionV4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: endBrowserSessionHandler,
};

export default endBrowserSessionRoute;
