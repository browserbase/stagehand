import type { ActResult as ActResultV2 } from "@browserbasehq/stagehand";
import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { ActResult as ActResultV3 } from "stagehand-v3";
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

// Schema for array format: [input, options] - V2
export const actSchemaV2 = z
  .object({
    action: z
      .string({
        /* eslint-disable-next-line camelcase */
        invalid_type_error: "`action` must be a string",
        /* eslint-disable-next-line camelcase */
        required_error: "`action` is required",
      })
      .min(1),
    variables: z.record(z.string()).optional(),
    domSettleTimeoutMs: z.number().optional(),
    slowDomBasedAct: z.boolean().optional(),
    timeoutMs: z.number().optional(),
    modelName: z.string().optional(),
    modelClientOptions: z
      .object({
        apiKey: z.string().optional(),
        baseURL: z.string().url().optional(),
      })
      .optional(),
    iframes: z.boolean().optional(),
    frameId: z.string().optional(),
  })
  .or(
    z.object({
      selector: z.string(),
      description: z.string(),
      backendNodeId: z.number().optional(),
      method: z.string().optional(),
      arguments: z.array(z.string()).optional(),
      frameId: z.string().optional(),
    }),
  );

// Schema for V3 - new structure
export const actSchemaV3 = z.object({
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

    return createStreamingResponse<
      z.infer<typeof actSchemaV2>,
      z.infer<typeof actSchemaV3>
    >({
      browserbaseSessionId: id,
      request,
      reply,
      schemaV2: actSchemaV2,
      schemaV3: actSchemaV3,
      stagehandMethod: "act",
      handler: async (stagehandWithVersion) => {
        const { stagehand, version, data } = stagehandWithVersion;

        // V3 logic
        if (version === "v3") {
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

          let result: ActResultV3;

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

          if (typeof data.input === "string") {
            result = await stagehand.act(data.input, safeOptions);
          } else {
            result = await stagehand.act(data.input, safeOptions);
          }

          const sanitizedResult = sanitizeResultWithVariables(
            result,
            data.options?.variables,
          );
          await updateActionResult(action.id, sanitizedResult);
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

        const method = "act";
        let xpath = "";
        let options = {};

        if ("action" in data) {
          options = { ...data };
        } else if (data.selector) {
          xpath = data.selector;
          options = {
            method: data.method,
            selector: data.selector,
            description: data.description,
            backendNodeId: data.backendNodeId,
            arguments: data.arguments,
          };
        }

        const url = page.url();
        // Temporarily mask frameId from DB/Session Replay
        options = { ...options, frameId: undefined };

        const action = await createAction({
          sessionId: id,
          method,
          xpath,
          options: sanitizeActionDbData(options),
          url,
        });

        let result: ActResultV2;

        if ("action" in data) {
          if (data.modelClientOptions) {
            result = await page.act(data);
          } else {
            result = await page.act(data);
          }
        } else {
          result = await page.act(data);
        }

        await updateActionResult(action.id, result);
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
    body: zodToJsonSchema(actSchemaV2),
  },
  handler: actRouteHandler,
};

export default actRoute;
