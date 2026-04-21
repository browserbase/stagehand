import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import { type FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionCreateRequestSchema,
  BrowserSessionHeadersSchema,
  BrowserSessionResponseSchema,
  BrowserSessionV4ErrorResponseSchema,
  type BrowserSessionCreateRequest,
} from "../../../schemas/v4/browserSession.js";
import { createBrowserSession } from "../stubState.js";

const createBrowserSessionHandler: RouteHandlerMethod = async (
  request,
  reply,
) => {
  const body = request.body as BrowserSessionCreateRequest;
  const llmId =
    body.llmId ?? (await request.server.llmService.createSystemDefaultLlm()).id;
  const browserSession = createBrowserSession(body, llmId);

  return reply.status(StatusCodes.OK).send(
    BrowserSessionResponseSchema.parse({
      success: true,
      data: {
        browserSession,
      },
    }),
  );
};

const createBrowserSessionRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession",
  schema: {
    operationId: "BrowserSessionCreate",
    summary: "Create a browser session",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionCreateRequestSchema,
    response: {
      200: BrowserSessionResponseSchema,
      400: BrowserSessionV4ErrorResponseSchema,
      401: BrowserSessionV4ErrorResponseSchema,
      500: BrowserSessionV4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionHandler,
};

export default createBrowserSessionRoute;
