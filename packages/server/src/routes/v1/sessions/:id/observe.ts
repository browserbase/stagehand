import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { Action } from "stagehand-v3";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod/v3";

import { authMiddleware } from "../../../../lib/auth.js";
import {
  createAction,
  updateActionResult,
} from "../../../../lib/db/actions.js";
import { getSession } from "../../../../lib/db/sessions.js";
import { withErrorHandling } from "../../../../lib/errorHandler.js";
import { createStreamingResponse } from "../../../../lib/stream.js";
import { sanitizeActionDbData } from "../../../../lib/utils.js";

interface ObserveParams {
  id: string;
}

export const observeSchema = z.object({
  instruction: z.string().optional(),
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
      timeout: z.number().optional(),
      selector: z.string().optional(),
    })
    .optional(),
  frameId: z.string().optional(),
});

const observeRouteHandler: RouteHandlerMethod = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return reply
        .status(StatusCodes.UNAUTHORIZED)
        .send({ error: "Unauthorized" });
    }

    const { id } = request.params as ObserveParams;

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

    return createStreamingResponse<z.infer<typeof observeSchema>>({
      browserbaseSessionId: id,
      request,
      reply,
      schema: observeSchema,
      stagehandMethod: "observe",
      handler: async ({ stagehand, data }) => {
        const { frameId } = data;
        const page = frameId
          ? stagehand.context.resolvePageByMainFrameId(frameId)
          : await stagehand.context.awaitActivePage();

        if (!page) {
          return reply.status(StatusCodes.NOT_FOUND).send({
            message: "Page not found",
          });
        }

        const url = page.url();

        // Temporarily mask frameId from DB/Session Replay
        const options = { ...data, frameId: undefined };

        // Create action first
        const action = await createAction({
          sessionId: id,
          method: "observe",
          xpath: "",
          options: sanitizeActionDbData(options),
          url,
        });

        const safeOptions = {
          ...data.options,
          model:
            data.options?.model &&
            typeof data.options.model.model === "string"
              ? {
                  ...data.options.model,
                  modelName: data.options.model.model,
                }
              : undefined,
          page,
        };

        let result: Action[];

        if (data.instruction) {
          result = await stagehand.observe(data.instruction, safeOptions);
        } else {
          result = await stagehand.observe(safeOptions);
        }

        await updateActionResult(action.id, result);
        return { result, actionId: action.id };
      },
    });
  },
);

const observeRoute: RouteOptions = {
  method: "POST",
  url: "/sessions/:id/observe",
  schema: {
    params: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
    body: zodToJsonSchema(observeSchema),
  },
  handler: observeRouteHandler,
};

export default observeRoute;
