import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { Action } from "@browserbasehq/stagehand";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod/v3";

import { authMiddleware } from "../../../../lib/auth.js";
import { withErrorHandling } from "../../../../lib/errorHandler.js";
import { createStreamingResponse } from "../../../../lib/stream.js";
import { getSessionStore } from "../../../../lib/sessionStoreManager.js";

interface ObserveParams {
  id: string;
}

export const observeSchema = z.object({
  instruction: z.string().optional(),
  options: z
    .object({
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

    const sessionStore = getSessionStore();
    const hasSession = await sessionStore.hasSession(id);
    if (!hasSession) {
      return reply.status(StatusCodes.NOT_FOUND).send({
        message: "Session not found",
      });
    }

    return createStreamingResponse<z.infer<typeof observeSchema>>({
      sessionId: id,
      request,
      reply,
      schema: observeSchema,
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

        const safeOptions = {
          ...data.options,
          model:
            data.options?.model && typeof data.options.model.model === "string"
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

        return { result };
      },
      operation: "observe",
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
