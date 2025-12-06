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

export const observeSchemaV2 = z.object({
  instruction: z.string().optional(),
  domSettleTimeoutMs: z.number().optional(),
  returnAction: z.boolean().optional(),
  onlyVisible: z.boolean().optional(),
  drawOverlay: z.boolean().optional(),
  modelName: z.string().optional(),
  modelClientOptions: z
    .object({
      apiKey: z.string().optional(),
      baseURL: z.string().url().optional(),
    })
    .optional(),
  iframes: z.boolean().optional(),
  frameId: z.string().optional(),
});

export const observeSchemaV3 = z.object({
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

    return createStreamingResponse<
      z.infer<typeof observeSchemaV2>,
      z.infer<typeof observeSchemaV3>
    >({
      browserbaseSessionId: id,
      request,
      reply,
      schemaV2: observeSchemaV2,
      schemaV3: observeSchemaV3,
      stagehandMethod: "observe",
      handler: async (stagehandWithVersion) => {
        const { stagehand, version, data } = stagehandWithVersion;

        // V3 logic
        if (version === "v3") {
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
        }

        // V2 logic
        /* eslint-disable */
        if (data.frameId) {
          const ctx = stagehand["stagehandContext"]; // Disabling eslint because of private property

          const shPage = ctx?.getStagehandPageByFrameId(data.frameId);
          if (shPage) ctx.setActivePage(shPage);
        }
        /* eslint-enable */
        const { page } = stagehand;

        const url = page.url();
        // Temporarily mask frameId from DB/Session Replay
        const options = { ...data, frameId: undefined };

        const action = await createAction({
          sessionId: id,
          method: "observe",
          xpath: "",
          options: sanitizeActionDbData(options),
          url,
        });

        const result = await page.observe(data);
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
    body: zodToJsonSchema(observeSchemaV2),
  },
  handler: observeRouteHandler,
};

export default observeRoute;
