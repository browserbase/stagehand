import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import { z } from "zod/v4";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import {
  ExtractRequestSchema,
  ExtractResultSchema,
  SessionIdParamsSchema,
} from "@browserbasehq/stagehand";

import { authMiddleware } from "../../../../lib/auth.js";
import { AppError, withErrorHandling } from "../../../../lib/errorHandler.js";
import { createStreamingResponse } from "../../../../lib/stream.js";
import { jsonSchemaToZod } from "../../../../lib/utils.js";
import { getSessionStore } from "../../../../lib/sessionStoreManager.js";

interface ExtractParams {
  id: string;
}

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

    return createStreamingResponse<z.infer<typeof ExtractRequestSchema>>({
      sessionId: id,
      request,
      reply,
      schema: ExtractRequestSchema,
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

        const modelOpt = data.options?.model;
        const normalizedModel =
          typeof modelOpt === "string"
            ? { modelName: modelOpt }
            : modelOpt
              ? { ...modelOpt, modelName: modelOpt.modelName ?? "gpt-4o" }
              : undefined;

        const safeOptions = {
          ...data.options,
          model: normalizedModel,
          page,
        };

        const extractFn = stagehand.extract.bind(stagehand);

        let result: unknown;

        if (data.instruction) {
          if (data.schema) {
            const zodSchema = jsonSchemaToZod(data.schema) as z.ZodObject;
            result = await extractFn(data.instruction, zodSchema, safeOptions);
          } else {
            result = await extractFn(data.instruction, safeOptions);
          }
        } else {
          result = await extractFn(safeOptions);
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
    params: SessionIdParamsSchema,
    body: ExtractRequestSchema,
    response: {
      200: z
        .object({
          success: z.literal(true),
          data: ExtractResultSchema,
        })
        .strict(),
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: extractRouteHandler,
};

export default extractRoute;
