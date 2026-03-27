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
  const llm =
    body.llmId !== undefined
      ? await request.server.llmService.getLlm(body.llmId)
      : await request.server.llmService.createSystemDefaultLlm();
  const [actLlmId, observeLlmId, extractLlmId] = await Promise.all([
    body.actLlmId
      ? request.server.llmService
          .getLlm(body.actLlmId)
          .then((value) => value.id)
      : Promise.resolve(null),
    body.observeLlmId
      ? request.server.llmService
          .getLlm(body.observeLlmId)
          .then((value) => value.id)
      : Promise.resolve(null),
    body.extractLlmId
      ? request.server.llmService
          .getLlm(body.extractLlmId)
          .then((value) => value.id)
      : Promise.resolve(null),
  ]);
  const browserSession = createBrowserSession(
    body,
    llm.id,
    actLlmId,
    observeLlmId,
    extractLlmId,
  );

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
