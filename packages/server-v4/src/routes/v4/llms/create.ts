import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  LLMCreateRequestSchema,
  LLMErrorResponseSchema,
  LLMHeadersSchema,
  LLMResponseSchema,
  type LLMCreateRequest,
} from "../../../schemas/v4/llm.js";
import { createLLM } from "../stubState.js";

const createLLMHandler: RouteHandlerMethod = async (request, reply) => {
  const body = request.body as LLMCreateRequest;
  const llm = createLLM(body);

  return reply.status(StatusCodes.OK).send(
    LLMResponseSchema.parse({
      success: true,
      data: {
        llm,
      },
    }),
  );
};

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
