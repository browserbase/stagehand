import type { RouteHandlerMethod, RouteOptions } from "fastify";
import { StatusCodes } from "http-status-codes";
import type { ExtractResult } from "stagehand-v3";
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
  jsonSchemaToZod,
  sanitizeActionDbData,
} from "../../../../lib/utils.js";

interface ExtractParams {
  id: string;
}

// Schema for array format: [instruction, options] - V2
export const extractSchemaV2 = z.object({
  instruction: z.string().optional(),
  schemaDefinition: z.record(z.unknown()).optional(),
  domSettleTimeoutMs: z.number().optional(),
  useTextExtract: z.boolean().optional(),
  selector: z.string().optional(),
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

// Schema for V3 - new structure
export const extractSchemaV3 = z.object({
  instruction: z.string().optional(),
  schema: z.record(z.unknown()).optional(),
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

    const session = await getSession(id);

    if (!session) {
      return reply.status(StatusCodes.NOT_FOUND).send({
        message: "Session not found",
      });
    }

    return createStreamingResponse<
      z.infer<typeof extractSchemaV2>,
      z.infer<typeof extractSchemaV3>
    >({
      browserbaseSessionId: id,
      request,
      reply,
      schemaV2: extractSchemaV2,
      schemaV3: extractSchemaV3,
      stagehandMethod: "extract",
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

          // Create action first
          const action = await createAction({
            sessionId: id,
            method: "extract",
            xpath: data.options?.selector ?? "",
            options: sanitizeActionDbData(options),
            url,
          });

          let result: ExtractResult<z.AnyZodObject>;

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

          if (data.instruction) {
            if (data.schema) {
              const zodSchema = jsonSchemaToZod(data.schema) as z.AnyZodObject;
              result = await stagehand.extract(
                data.instruction,
                zodSchema,
                // safeOptions,
              );
            } else {
              result = await stagehand.extract(data.instruction, safeOptions);
            }
          } else {
            result = await stagehand.extract(safeOptions);
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

        const action = await createAction({
          sessionId: id,
          method: "extract",
          xpath: data.selector ?? "",
          // Temporarily mask frameId from DB/Session Replay
          options: sanitizeActionDbData({ ...data, frameId: undefined }),
          url,
        });

        let result: Record<string, unknown>;
        // We need to pass modelName to extract to respect the modelClientOptions
        // TODO: remove this once patched in stagehand
        let modelName;
        if (data.modelClientOptions) {
          modelName = data.modelName ?? session.modelName;
        }

        if (data.instruction) {
          if (data.schemaDefinition) {
            const zodSchema = jsonSchemaToZod(data.schemaDefinition);
            result = (await page.extract<z.infer<typeof zodSchema>>({
              instruction: data.instruction,
              schema: zodSchema,
              useTextExtract: data.useTextExtract,
              selector: data.selector,
              modelName: modelName,
              modelClientOptions: data.modelClientOptions,
              iframes: data.iframes,
            })) as Record<string, unknown>;
          } else {
            result = (await page.extract({
              instruction: data.instruction,
              modelName: modelName,
              modelClientOptions: data.modelClientOptions,
            })) as Record<string, unknown>;
          }
        } else {
          result = (await page.extract()) as Record<string, unknown>;
        }

        await updateActionResult(action.id, result);
        return { result, actionId: action.id };
      },
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
    body: zodToJsonSchema(extractSchemaV2),
  },
  handler: extractRouteHandler,
};

export default extractRoute;
