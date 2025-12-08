import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod/v3";

import { authMiddleware } from "../../../../lib/auth.js";
import { withErrorHandling } from "../../../../lib/errorHandler.js";
import { createStreamingResponse } from "../../../../lib/stream.js";
import { getSessionStore } from "../../../../lib/sessionStoreManager.js";

interface NavigateParams {
  id: string;
}

export const navigateSchema = z.object({
  url: z.string({
    invalid_type_error: "`url` must be a string",
    required_error: "`url` is required",
  }),
  options: z
    .object({
      referer: z.string().optional(),
      timeout: z.number().optional(),
      waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
    })
    .optional(),
  frameId: z.string().optional(),
});

const navigateRouteHandler: RouteHandlerMethod = withErrorHandling(
  async (request, reply) => {
    if (!(await authMiddleware(request))) {
      return reply
        .status(StatusCodes.UNAUTHORIZED)
        .send({ error: "Unauthorized" });
    }

    const { id } = request.params as NavigateParams;

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

    return createStreamingResponse<z.infer<typeof navigateSchema>>({
      sessionId: id,
      request,
      reply,
      schema: navigateSchema,
      handler: async ({ stagehand, data }) => {
        const page = data.frameId
          ? stagehand.context.resolvePageByMainFrameId(data.frameId)
          : await stagehand.context.awaitActivePage();

        if (!page) {
          return reply.status(StatusCodes.NOT_FOUND).send({
            message: "Page not found",
          });
        }

        const result = await page.goto(data.url, data.options);

        return { result };
      },
      operation: "navigate",
    });
  },
);

const navigateRoute: RouteOptions = {
  method: "POST",
  url: "/sessions/:id/navigate",
  schema: {
    params: {
      type: "object",
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
    body: zodToJsonSchema(navigateSchema),
  },
  handler: navigateRouteHandler,
};

export default navigateRoute;
