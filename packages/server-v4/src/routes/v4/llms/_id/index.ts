import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  LLMHeadersSchema,
  LLMIdParamsSchema,
  LLMResponseSchema,
  type LLMIdParams,
} from "../../../../schemas/v4/llm.js";
import { getLLM } from "../../stubState.js";

const getLLMHandler: RouteHandlerMethod = async (request, reply) => {
  const { id } = request.params as LLMIdParams;
  const llm = getLLM(id);

  return reply.status(StatusCodes.OK).send(
    LLMResponseSchema.parse({
      success: true,
      data: {
        llm,
      },
    }),
  );
};

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
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: getLLMHandler,
};

export default getLLMRoute;
