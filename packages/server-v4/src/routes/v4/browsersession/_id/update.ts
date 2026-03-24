import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionHeadersSchema,
  BrowserSessionIdParamsSchema,
  BrowserSessionResponseSchema,
  BrowserSessionUpdateRequestSchema,
  BrowserSessionV4ErrorResponseSchema,
  type BrowserSessionIdParams,
  type BrowserSessionUpdateRequest,
} from "../../../../schemas/v4/browserSession.js";
import { updateBrowserSession } from "../../stubState.js";

const updateBrowserSessionHandler: RouteHandlerMethod = async (
  request,
  reply,
) => {
  const { id } = request.params as BrowserSessionIdParams;
  const body = request.body as BrowserSessionUpdateRequest;
  const browserSession = updateBrowserSession(id, body);

  return reply.status(StatusCodes.OK).send(
    BrowserSessionResponseSchema.parse({
      success: true,
      data: {
        browserSession,
      },
    }),
  );
};

const updateBrowserSessionRoute: RouteOptions = {
  method: "PATCH",
  url: "/browsersession/:id",
  schema: {
    operationId: "BrowserSessionUpdate",
    summary: "Update a browser session",
    headers: BrowserSessionHeadersSchema,
    params: BrowserSessionIdParamsSchema,
    body: BrowserSessionUpdateRequestSchema,
    response: {
      200: BrowserSessionResponseSchema,
      404: BrowserSessionV4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: updateBrowserSessionHandler,
};

export default updateBrowserSessionRoute;
