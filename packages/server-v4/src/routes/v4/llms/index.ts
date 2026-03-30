import type { RouteHandlerMethod, RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  LLMHeadersSchema,
  LLMListResponseSchema,
} from "../../../schemas/v4/llm.js";

const listLLMsHandler: RouteHandlerMethod = async (request, reply) =>
  request.server.llmController.list(request, reply);

const listLLMsRoute: RouteOptions = {
  method: "GET",
  url: "/llms",
  schema: {
    operationId: "LLMList",
    summary: "List llms",
    headers: LLMHeadersSchema,
    response: {
      200: LLMListResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: listLLMsHandler,
};

export default listLLMsRoute;
