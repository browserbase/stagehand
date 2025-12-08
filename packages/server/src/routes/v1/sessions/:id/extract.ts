import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { ExtractResult } from "@browserbasehq/stagehand";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod/v3";

import { authMiddleware } from "../../../../lib/auth.js";
import { AppError, withErrorHandling } from "../../../../lib/errorHandler.js";
import { createStreamingResponse } from "../../../../lib/stream.js";
import { jsonSchemaToZod } from "../../../../lib/utils.js";
import { getSessionStore } from "../../../../lib/sessionStoreManager.js";

interface ExtractParams {
  id: string;
}

// Schema for V3
export const extractSchema = z.object({
  instruction: z.string().optional(),
  schema: z.record(z.unknown()).optional(),
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

const extractRouteHandler: RouteHandlerMethod = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return reply
        .status(StatusCodes.UNAUTHORIZED)
        .send({ error: "Unauthorized" });
    }

    const { id } = request.params as ExtractParams;

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

    return createStreamingResponse<z.infer<typeof extractSchema>>({
      sessionId: id,
      request,
      reply,
      schema: extractSchema,
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

        let result: ExtractResult<z.AnyZodObject>;

        if (data.instruction) {
          if (data.schema) {
            const zodSchema = jsonSchemaToZod(data.schema) as z.AnyZodObject;
            result = await stagehand.extract(
              data.instruction,
              zodSchema,
              safeOptions,
            );
          } else {
            result = await stagehand.extract(data.instruction, safeOptions);
          }
        } else {
          result = await stagehand.extract(safeOptions);
        }

        return { result };
      },
      operation: "extract",
    });
  },
);

const extractRoute: RouteOptions = {
  method: "POST",
  url: "/sessions/:id/extract",
  schema: {
    params: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
    body: zodToJsonSchema(extractSchema),
  },
  handler: extractRouteHandler,
};

export default extractRoute;
