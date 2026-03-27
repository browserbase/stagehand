import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  LLMHeadersSchema,
  LLMListResponseSchema,
} from "../../../schemas/v4/llm.js";
import { listLLMs } from "../stubState.js";

const listLLMsHandler: RouteHandlerMethod = async (_request, reply) => {
  return reply.status(StatusCodes.OK).send(
    LLMListResponseSchema.parse({
      success: true,
      data: {
        llms: listLLMs(),
      },
    }),
  );
};

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
