import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { ZodTypeAny } from "zod/v3";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import { Api } from "@browserbasehq/stagehand";

import { authMiddleware } from "../../../../lib/auth.js";
import { AppError, withErrorHandling } from "../../../../lib/errorHandler.js";
import { createStreamingResponse } from "../../../../lib/stream.js";
import { jsonSchemaToZod } from "../../../../lib/utils.js";
import { getSessionStore } from "../../../../lib/sessionStoreManager.js";

const extractRouteHandler: RouteHandlerMethod = withErrorHandling(
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

    return createStreamingResponse<Api.ExtractRequest>({
      sessionId: id,
      request,
      reply,
      schema: Api.ExtractRequestSchema,
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
            const zodSchema = jsonSchemaToZod(data.schema) as ZodTypeAny;
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
    ...Api.Operations.SessionExtract,
    headers: Api.SessionHeadersSchema,
    params: Api.SessionIdParamsSchema,
    body: Api.ExtractRequestSchema,
    response: {
      200: Api.ExtractResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: extractRouteHandler,
};

export default extractRoute;
