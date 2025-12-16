import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import { z } from "zod/v4";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import {
  AgentExecuteRequestSchema,
  AgentExecuteResultSchema,
  SessionIdParamsSchema,
} from "@browserbasehq/stagehand";

import { authMiddleware } from "../../../../lib/auth.js";
import { AppError, withErrorHandling } from "../../../../lib/errorHandler.js";
import { createStreamingResponse } from "../../../../lib/stream.js";
import { getSessionStore } from "../../../../lib/sessionStoreManager.js";

interface AgentExecuteParams {
  id: string;
}

const agentExecuteRouteHandler: RouteHandlerMethod = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return reply
        .status(StatusCodes.UNAUTHORIZED)
        .send({ error: "Unauthorized" });
    }

    const { id } = request.params as AgentExecuteParams;

    if (!id.length) {
      return reply.status(StatusCodes.BAD_REQUEST).send({
        message: "Missing session id",
      });
    }

    const sessionStore = getSessionStore();
    const hasSession = await sessionStore.hasSession(id);
    if (!hasSession) {
      return reply.status(StatusCodes.NOT_FOUND).send({
        message: "Session not found",
      });
    }

    return createStreamingResponse<z.infer<typeof AgentExecuteRequestSchema>>({
      sessionId: id,
      request,
      reply,
      schema: AgentExecuteRequestSchema,
      handler: async ({ stagehand, data }) => {
        const { agentConfig, executeOptions } = data;
        const { frameId } = data;
        const page = frameId
          ? stagehand.context.resolvePageByMainFrameId(frameId)
          : await stagehand.context.awaitActivePage();
        if (!page) {
          throw new AppError(
            "Page not found",
            StatusCodes.INTERNAL_SERVER_ERROR,
          );
        }
        const normalizedAgentConfig = {
          ...agentConfig,
          model:
            typeof agentConfig.model === "string"
              ? { modelName: agentConfig.model }
              : agentConfig.model
                ? {
                    ...agentConfig.model,
                    modelName: agentConfig.model.modelName ?? "gpt-4o",
                  }
                : undefined,
        };

        const { instruction, ...restExecuteOptions } = executeOptions;
        const fullExecuteOptions = {
          instruction,
          ...restExecuteOptions,
          page,
        };
        const result = await stagehand
          .agent(normalizedAgentConfig)
          .execute(fullExecuteOptions);

        return { result };
      },
      operation: "agentExecute",
    });
  },
);

const agentExecuteRoute: RouteOptions = {
  method: "POST",
  url: "/sessions/:id/agentExecute",
  schema: {
    params: SessionIdParamsSchema,
    body: AgentExecuteRequestSchema,
    response: {
      200: z
        .object({
          success: z.literal(true),
          data: AgentExecuteResultSchema,
        })
        .strict(),
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: agentExecuteRouteHandler,
};

export default agentExecuteRoute;
