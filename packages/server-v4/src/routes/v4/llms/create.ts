import type { RouteHandlerMethod, RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  LLMCreateRequestSchema,
  LLMErrorResponseSchema,
  LLMHeadersSchema,
  LLMResponseSchema,
} from "../../../schemas/v4/llm.js";

const createLLMHandler: RouteHandlerMethod = async (request, reply) =>
  request.server.llmController.create(request, reply);

const createLLMRoute: RouteOptions = {
  method: "POST",
  url: "/llms",
  schema: {
    operationId: "LLMCreate",
    summary: "Create an llm",
    headers: LLMHeadersSchema,
    body: LLMCreateRequestSchema,
    response: {
      200: LLMResponseSchema,
      400: LLMErrorResponseSchema,
      401: LLMErrorResponseSchema,
      500: LLMErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createLLMHandler,
};

export default createLLMRoute;
