import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import { Api } from "@browserbasehq/stagehand";

import { authMiddleware } from "../../../../lib/auth.js";
import { AppError, withErrorHandling } from "../../../../lib/errorHandler.js";
import { createStreamingResponse } from "../../../../lib/stream.js";
import { getSessionStore } from "../../../../lib/sessionStoreManager.js";

const agentExecuteRouteHandler: RouteHandlerMethod = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return reply
        .status(StatusCodes.UNAUTHORIZED)
        .send({ error: "Unauthorized" });
    }

    const { id } = request.params as Api.SessionIdParams;

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

    return createStreamingResponse<Api.AgentExecuteRequest>({
      sessionId: id,
      request,
      reply,
      schema: Api.AgentExecuteRequestSchema,
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
        let result;
        try {
          result = await stagehand
            .agent(normalizedAgentConfig)
            .execute(fullExecuteOptions);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new AppError(message, StatusCodes.UNPROCESSABLE_ENTITY);
        }

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
    ...Api.Operations.SessionAgentExecute,
    headers: Api.SessionHeadersSchema,
    params: Api.SessionIdParamsSchema,
    body: Api.AgentExecuteRequestSchema,
    response: {
      200: {
        content: {
          "application/json": {
            schema: Api.AgentExecuteResponseSchema,
          },
          "text/event-stream": {
            schema: Api.StreamEventSchema,
          },
        },
      },
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: agentExecuteRouteHandler,
};

export default agentExecuteRoute;
