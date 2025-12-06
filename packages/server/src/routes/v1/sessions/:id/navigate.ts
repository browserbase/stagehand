import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod/v3";

import { authMiddleware } from "../../../../lib/auth.js";
import { createAction } from "../../../../lib/db/actions.js";
import { getSession } from "../../../../lib/db/sessions.js";
import { withErrorHandling } from "../../../../lib/errorHandler.js";
import { createStreamingResponse } from "../../../../lib/stream.js";

interface NavigateParams {
  id: string;
}

export const navigateSchemaV2 = z.object({
  url: z.string({
    /* eslint-disable-next-line camelcase */
    invalid_type_error: "`url` must be a string",
    /* eslint-disable-next-line camelcase */
    required_error: "`url` is required",
  }),
  options: z
    .object({
      referer: z.string().optional(),
      timeout: z.number().optional(),
      waitUntil: z
        .enum(["load", "domcontentloaded", "networkidle", "commit"])
        .optional(),
    })
    .optional(),
  frameId: z.string().optional(),
});

export const navigateSchemaV3 = z.object({
  url: z.string({
    /* eslint-disable-next-line camelcase */
    invalid_type_error: "`url` must be a string",
    /* eslint-disable-next-line camelcase */
    required_error: "`url` is required",
  }),
  options: z
    .object({
      referer: z.string().optional(),
      timeout: z.number().optional(),
      waitUntil: z.enum(["load", "domcontentloaded", "networkidle"]).optional(),
    })
    .optional(),
  frameId: z.string(),
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

    const session = await getSession(id);

    if (!session) {
      return reply.status(StatusCodes.NOT_FOUND).send({
        message: "Session not found",
      });
    }

    return createStreamingResponse<
      z.infer<typeof navigateSchemaV2>,
      z.infer<typeof navigateSchemaV3>
    >({
      browserbaseSessionId: id,
      request,
      reply,
      schemaV2: navigateSchemaV2,
      schemaV3: navigateSchemaV3,
      handler: async (stagehandWithVersion) => {
        const { stagehand, version, data } = stagehandWithVersion;

        if (version === "v3") {
          const page = data.frameId
            ? stagehand.context.resolvePageByMainFrameId(data.frameId)
            : await stagehand.context.awaitActivePage();

          if (!page) {
            return reply.status(StatusCodes.NOT_FOUND).send({
              message: "Page not found",
            });
          }

          // Run createAction and page.goto in parallel
          const [action, result] = await Promise.all([
            createAction({
              sessionId: id,
              method: "navigate",
              xpath: "",
              options: {
                url: data.url,
                ...(data.options
                  ? { ...data.options, frameId: undefined }
                  : {}),
              },
              url: data.url,
            }),
            page.goto(data.url, data.options),
          ]);

          return { result, actionId: action.id };
        }

        // V2 logic
        const { page } = stagehand;

        const action = await createAction({
          sessionId: id,
          method: "navigate",
          xpath: "",
          options: {
            url: data.url,
            ...(data.options ? { ...data.options, frameId: undefined } : {}),
          },
          url: data.url,
        });

        const result = await page.goto(data.url, data.options);
        return { result, actionId: action.id };
      },
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
    body: zodToJsonSchema(navigateSchemaV2),
  },
  handler: navigateRouteHandler,
};

export default navigateRoute;
