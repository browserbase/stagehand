import type { RouteHandlerMethod, RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  LLMErrorResponseSchema,
  LLMHeadersSchema,
  LLMIdParamsSchema,
  LLMResponseSchema,
} from "../../../../schemas/v4/llm.js";

const getLLMHandler: RouteHandlerMethod = async (request, reply) =>
  request.server.llmController.get(request, reply);

const getLLMRoute: RouteOptions = {
  method: "GET",
  url: "/llms/:id",
  schema: {
    operationId: "LLMRetrieve",
    summary: "Get an llm",
    headers: LLMHeadersSchema,
    params: LLMIdParamsSchema,
    response: {
      200: LLMResponseSchema,
      400: LLMErrorResponseSchema,
      401: LLMErrorResponseSchema,
      404: LLMErrorResponseSchema,
      500: LLMErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: getLLMHandler,
};

export default getLLMRoute;
