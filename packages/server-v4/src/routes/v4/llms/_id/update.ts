import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  LLMHeadersSchema,
  LLMIdParamsSchema,
  LLMResponseSchema,
  LLMUpdateRequestSchema,
  type LLMIdParams,
  type LLMUpdateRequest,
} from "../../../../schemas/v4/llm.js";
import { updateLLM } from "../../stubState.js";

const updateLLMHandler: RouteHandlerMethod = async (request, reply) => {
  const { id } = request.params as LLMIdParams;
  const body = request.body as LLMUpdateRequest;
  const llm = updateLLM(id, body);

  return reply.status(StatusCodes.OK).send(
    LLMResponseSchema.parse({
      success: true,
      data: {
        llm,
      },
    }),
  );
};

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
