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

async function resolveOptionalLLMId(
  request: Parameters<RouteHandlerMethod>[0],
  id: string | undefined,
): Promise<string | null> {
  if (!id) {
    return null;
  }

  const llm = await request.server.llmService.getLlm(id);
  return llm.id;
}

const createBrowserSessionHandler: RouteHandlerMethod = async (
  request,
  reply,
) => {
  const body = request.body as BrowserSessionCreateRequest;
  const llm =
    body.llmId !== undefined
      ? await request.server.llmService.getLlm(body.llmId)
      : await request.server.llmService.createSystemDefaultLlm();
  const browserSession = createBrowserSession(body, {
    llmId: llm.id,
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
