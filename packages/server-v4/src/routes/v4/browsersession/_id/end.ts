import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionEndRequestSchema,
  BrowserSessionHeadersSchema,
  BrowserSessionIdParamsSchema,
  BrowserSessionResponseSchema,
  type BrowserSessionIdParams,
} from "../../../../schemas/v4/browserSession.js";
import { buildBrowserSession } from "../shared.js";

const endBrowserSessionHandler: RouteHandlerMethod = async (request, reply) => {
  const { id } = request.params as BrowserSessionIdParams;

  return reply.status(StatusCodes.OK).send(
    BrowserSessionResponseSchema.parse({
      success: true,
      data: {
        browserSession: buildBrowserSession({
          id,
          env: "LOCAL",
          status: "ended",
          modelName: "stub/model",
          cdpUrl: "ws://stub.invalid/devtools/browser/stub",
          available: false,
        }),
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
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: endBrowserSessionHandler,
};

export default endBrowserSessionRoute;
