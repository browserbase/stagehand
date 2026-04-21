import type { RouteHandlerMethod, RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  LLMHeadersSchema,
  LLMIdParamsSchema,
  LLMResponseSchema,
  LLMUpdateRequestSchema,
} from "../../../../schemas/v4/llm.js";

const updateLLMHandler: RouteHandlerMethod = async (request, reply) =>
  request.server.llmController.update(request, reply);

const updateLLMRoute: RouteOptions = {
  method: "PATCH",
  url: "/llms/:id",
  schema: {
    operationId: "LLMUpdate",
    summary: "Update an llm",
    headers: LLMHeadersSchema,
    params: LLMIdParamsSchema,
    body: LLMUpdateRequestSchema,
    response: {
      200: LLMResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: updateLLMHandler,
};

export default updateLLMRoute;
