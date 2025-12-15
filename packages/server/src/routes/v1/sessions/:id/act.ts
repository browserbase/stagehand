import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { ActResult, Action } from "@browserbasehq/stagehand";
import { z } from "zod/v4";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import { authMiddleware } from "../../../../lib/auth.js";
import { AppError, withErrorHandling } from "../../../../lib/errorHandler.js";
import { createStreamingResponse } from "../../../../lib/stream.js";
import { getSessionStore } from "../../../../lib/sessionStoreManager.js";

interface ActParams {
  id: string;
}

export const actSchema = z.object({
  input: z.string().or(
    z.object({
      selector: z.string(),
      description: z.string(),
      method: z.string().optional(),
      arguments: z.array(z.string()).optional(),
    }),
  ),
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
      variables: z.record(z.string(), z.string()).optional(),
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

    const sessionStore = getSessionStore();
    const hasSession = await sessionStore.hasSession(id);
    if (!hasSession) {
      return reply.status(StatusCodes.NOT_FOUND).send({
        message: "Session not found",
      });
    }

    return createStreamingResponse<z.infer<typeof actSchema>>({
      sessionId: id,
      request,
      reply,
      schema: actSchema,
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

        let result: ActResult;
        if (typeof data.input === "string") {
          result = await stagehand.act(data.input, safeOptions);
        } else {
          result = await stagehand.act(data.input as Action, safeOptions);
        }

        return { result };
      },
      operation: "act",
    });
  },
);

const actRoute: RouteOptions = {
  method: "POST",
  url: "/sessions/:id/act",
  schema: {
    params: z.object({ id: z.string() }).strict(),
    body: actSchema,
    response: {
      200: z
        .object({
          success: z.literal(true),
          data: z
            .object({
              result: z.unknown(),
            })
            .strict(),
        })
        .strict(),
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: actRouteHandler,
};

export default actRoute;
