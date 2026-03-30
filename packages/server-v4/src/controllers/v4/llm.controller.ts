import type { FastifyReply, FastifyRequest } from "fastify";
import { StatusCodes } from "http-status-codes";

import {
  LLMListResponseSchema,
  LLMResponseSchema,
  type LLMCreateRequest,
  type LLMIdParams,
  type LLMUpdateRequest,
} from "../../schemas/v4/llm.js";
import type { LlmService } from "../../services/llm/llm.service.js";

export class LlmController {
  constructor(private readonly llmService: LlmService) {}

  async list(_request: FastifyRequest, reply: FastifyReply) {
    const llms = await this.llmService.listLlms();

    return reply.status(StatusCodes.OK).send(
      LLMListResponseSchema.parse({
        success: true,
        data: {
          llms,
        },
      }),
    );
  }

  async create(request: FastifyRequest, reply: FastifyReply) {
    const body = request.body as LLMCreateRequest;
    const llm = await this.llmService.createLlm(body);

    return reply.status(StatusCodes.OK).send(
      LLMResponseSchema.parse({
        success: true,
        data: {
          llm,
        },
      }),
    );
  }

  async get(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as LLMIdParams;
    const llm = await this.llmService.getLlm(id);

    return reply.status(StatusCodes.OK).send(
      LLMResponseSchema.parse({
        success: true,
        data: {
          llm,
        },
      }),
    );
  }

  async update(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as LLMIdParams;
    const body = request.body as LLMUpdateRequest;
    const llm = await this.llmService.updateLlm(id, body);

    return reply.status(StatusCodes.OK).send(
      LLMResponseSchema.parse({
        success: true,
        data: {
          llm,
        },
      }),
    );
  }
}
