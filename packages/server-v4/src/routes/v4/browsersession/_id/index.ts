import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionHeadersSchema,
  BrowserSessionIdParamsSchema,
  BrowserSessionResponseSchema,
  BrowserSessionV4ErrorResponseSchema,
  type BrowserSessionIdParams,
} from "../../../../schemas/v4/browserSession.js";
import { getBrowserSession } from "../../stubState.js";

const getBrowserSessionHandler: RouteHandlerMethod = async (request, reply) => {
  const { id } = request.params as BrowserSessionIdParams;
  const browserSession = getBrowserSession(id);

  return reply.status(StatusCodes.OK).send(
    BrowserSessionResponseSchema.parse({
      success: true,
      data: {
        browserSession,
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
      404: BrowserSessionV4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: getBrowserSessionHandler,
};

export default getBrowserSessionRoute;
