import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { ActResult } from "stagehand-v3";
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
import {
  sanitizeActionDbData,
  sanitizeResultWithVariables,
} from "../../../../lib/utils.js";

interface ActParams {
  id: string;
}

// Schema for V3
export const actSchema = z.object({
  input: z.string().or(
    z.object({
      selector: z.string(),
      description: z.string(),
      backendNodeId: z.number().optional(),
      method: z.string().optional(),
      arguments: z.array(z.string()).optional(),
    }),
  ),
  options: z
    .object({
      model: z
        .object({
          provider: z.string().optional(),
          model: z.string().optional(),
          apiKey: z.string().optional(),
          baseURL: z.string().url().optional(),
        })
        .optional(),
      variables: z.record(z.string()).optional(),
      timeout: z.number().optional(),
    })
    .optional(),
  frameId: z.string().optional(),
});

const actRouteHandler: RouteHandlerMethod = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return reply
        .status(StatusCodes.UNAUTHORIZED)
        .send({ error: "Unauthorized" });
    }

    const { id } = request.params as ActParams;

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

    return createStreamingResponse<z.infer<typeof actSchema>>({
      browserbaseSessionId: id,
      request,
      reply,
      schema: actSchema,
      stagehandMethod: "act",
      handler: async ({ stagehand, data }) => {
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

        const url = page.url();

        // Temporarily mask frameId from DB/Session Replay
        const options = { ...data, frameId: undefined };

        const action = await createAction({
          sessionId: id,
          method: "act",
          xpath: "",
          options: sanitizeActionDbData(options),
          url,
        });

        const safeOptions = {
          ...data.options,
          model: data.options?.model
            ? {
                ...data.options.model,
                modelName: data.options.model.model ?? "gpt-4o",
              }
            : undefined,
          page,
        };

        const result: ActResult = await stagehand.act(data.input, safeOptions);

        const sanitizedResult = sanitizeResultWithVariables(
          result,
          data.options?.variables,
        );
        await updateActionResult(action.id, sanitizedResult);
        return { result, actionId: action.id };
      },
    });
  },
);

const actRoute: RouteOptions = {
  method: "POST",
  url: "/sessions/:id/act",
  schema: {
    params: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
    body: zodToJsonSchema(actSchema),
  },
  handler: actRouteHandler,
};

export default actRoute;
