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
import { getBrowserSession, updateBrowserSession } from "../../stubState.js";

const updateBrowserSessionHandler: RouteHandlerMethod = async (
  request,
  reply,
) => {
  const { id } = request.params as BrowserSessionIdParams;
  const body = request.body as BrowserSessionUpdateRequest;
  const existingBrowserSession = getBrowserSession(id);
  const llmId =
    body.llmId !== undefined
      ? (await request.server.llmService.getLlm(body.llmId)).id
      : existingBrowserSession.llmId;
  const [actLlmId, observeLlmId, extractLlmId] = await Promise.all([
    body.actLlmId === undefined
      ? Promise.resolve(undefined)
      : body.actLlmId === null
        ? Promise.resolve(null)
        : request.server.llmService
            .getLlm(body.actLlmId)
            .then((value) => value.id),
    body.observeLlmId === undefined
      ? Promise.resolve(undefined)
      : body.observeLlmId === null
        ? Promise.resolve(null)
        : request.server.llmService
            .getLlm(body.observeLlmId)
            .then((value) => value.id),
    body.extractLlmId === undefined
      ? Promise.resolve(undefined)
      : body.extractLlmId === null
        ? Promise.resolve(null)
        : request.server.llmService
            .getLlm(body.extractLlmId)
            .then((value) => value.id),
  ]);
  const browserSession = updateBrowserSession(
    id,
    body,
    llmId,
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
