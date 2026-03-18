import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionHeadersSchema,
  BrowserSessionIdParamsSchema,
  BrowserSessionResponseSchema,
  type BrowserSessionIdParams,
} from "../../../../schemas/v4/browserSession.js";
import { buildBrowserSession } from "../shared.js";

const getBrowserSessionHandler: RouteHandlerMethod = async (request, reply) => {
  const { id } = request.params as BrowserSessionIdParams;

  return reply.status(StatusCodes.OK).send(
    BrowserSessionResponseSchema.parse({
      success: true,
      data: {
        browserSession: buildBrowserSession({
          id,
          env: "LOCAL",
          status: "running",
          modelName: "stub/model",
          cdpUrl: "ws://stub.invalid/devtools/browser/stub",
          available: false,
        }),
      },
    }),
  );
};

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
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: getBrowserSessionHandler,
};

export default getBrowserSessionRoute;
