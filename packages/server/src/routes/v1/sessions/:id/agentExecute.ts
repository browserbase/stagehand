import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod/v3";

import { authMiddleware } from "../../../../lib/auth.js";
import {
  createAction,
  updateActionResult,
} from "../../../../lib/db/actions.js";
import { getSession } from "../../../../lib/db/sessions.js";
import { AppError, withErrorHandling } from "../../../../lib/errorHandler.js";
import { createStreamingResponse } from "../../../../lib/stream.js";
import { sanitizeActionDbData } from "../../../../lib/utils.js";

interface AgentExecuteParams {
  id: string;
}

const agentExecuteSchema = z.object({
  agentConfig: z.object({
    provider: z.enum(["openai", "anthropic", "google"]).optional(),
    model: z
      .string()
      .optional()
      .or(
        z.object({
          provider: z.enum(["openai", "anthropic", "google"]).optional(),
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

    const session = await getSession(id);

    if (!session) {
      return reply.status(StatusCodes.NOT_FOUND).send({
        message: "Session not found",
      });
    }

    return createStreamingResponse<z.infer<typeof agentExecuteSchema>>({
      browserbaseSessionId: id,
      request,
      reply,
      schema: agentExecuteSchema,
      handler: async ({ stagehand, data }) => {
        const { agentConfig, executeOptions } = data;
        const method = "agentExecute";
        const xpath = "";
        const safeAgentConfig = {
          model: agentConfig.model,
          systemPrompt: agentConfig.systemPrompt,
        };
        const combinedOptions = {
          agentExecuteOptions: executeOptions,
          agentConfig: safeAgentConfig,
        };
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
        const url = page.url();
        const action = await createAction({
          sessionId: id,
          method,
          xpath,
          url,
          options: sanitizeActionDbData(combinedOptions),
        });
        const result = await stagehand
          .agent(agentConfig)
          .execute(fullExecuteOptions);

        await updateActionResult(action.id, result);
        return { result, actionId: action.id };
      },
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
