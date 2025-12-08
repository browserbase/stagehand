import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod/v3";

import { authMiddleware } from "../../../../lib/auth.js";
import { AppError, withErrorHandling } from "../../../../lib/errorHandler.js";
import { createStreamingResponse } from "../../../../lib/stream.js";
import { getSessionStore } from "../../../../lib/sessionStoreManager.js";

interface AgentExecuteParams {
  id: string;
}

const agentExecuteSchema = z.object({
  agentConfig: z.object({
    model: z
      .string()
      .or(
        z.object({
          modelName: z.string(),
          apiKey: z.string().optional(),
          baseURL: z.string().url().optional(),
        }),
      )
      .optional(),
    systemPrompt: z.string().optional(),
    cua: z.boolean().optional(),
  }),
  executeOptions: z.object({
    instruction: z.string(),
    maxSteps: z.number().optional(),
    highlightCursor: z.boolean().optional(),
  }),
  frameId: z.string().optional(),
});

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

    return createStreamingResponse<z.infer<typeof agentExecuteSchema>>({
      sessionId: id,
      request,
      reply,
      schema: agentExecuteSchema,
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
        const fullExecuteOptions = {
          ...executeOptions,
          page,
        };
        const result = await stagehand
          .agent(agentConfig)
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
    params: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
    body: zodToJsonSchema(agentExecuteSchema),
  },
  handler: agentExecuteRouteHandler,
};

export default agentExecuteRoute;
