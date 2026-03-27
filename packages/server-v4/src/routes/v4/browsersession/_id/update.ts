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

async function resolveOptionalLLMId(
  request: Parameters<RouteHandlerMethod>[0],
  id: string | null | undefined,
): Promise<string | null> {
  if (id === undefined || id === null) {
    return id ?? null;
  }

  const llm = await request.server.llmService.getLlm(id);
  return llm.id;
}

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
  const browserSession = updateBrowserSession(id, body, {
    llmId,
    actLlmId: await resolveOptionalLLMId(request, body.actLlmId),
    observeLlmId: await resolveOptionalLLMId(request, body.observeLlmId),
    extractLlmId: await resolveOptionalLLMId(request, body.extractLlmId),
  });

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
