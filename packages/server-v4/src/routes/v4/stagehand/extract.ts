import type { RouteOptions } from "fastify";
import type { ExtractOptions } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";
import type { ZodTypeAny } from "zod/v3";

import { jsonSchemaToZod } from "../../../lib/utils.js";
import {
  StagehandExtractRequestSchema,
  StagehandExtractResponseSchema,
  type StagehandExtractParams,
} from "../../../schemas/v4/stagehand.js";
import {
  createStagehandRouteHandler,
  normalizeStagehandModel,
  resolveStagehandPage,
  stagehandErrorResponses,
} from "./shared.js";

const extractRoute: RouteOptions = {
  method: "POST",
  url: "/stagehand/extract",
  schema: {
    operationId: "StagehandExtract",
    summary: "stagehand.extract",
    body: StagehandExtractRequestSchema,
    response: {
      200: StagehandExtractResponseSchema,
      ...stagehandErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createStagehandRouteHandler<StagehandExtractParams>({
    eventType: "StagehandExtract",
    execute: async ({ params, stagehand }) => {
      const page = await resolveStagehandPage(stagehand, params.frameId);
      const options: ExtractOptions = {
        ...params.options,
        page,
        ...(params.options?.model !== undefined
          ? {
              model: normalizeStagehandModel(
                params.options.model,
              ) as ExtractOptions["model"],
            }
          : {}),
      };

      if (params.instruction) {
        if (params.schema) {
          const schema = jsonSchemaToZod(params.schema) as ZodTypeAny;
          return await stagehand.extract(params.instruction, schema, options);
        }

        return await stagehand.extract(params.instruction, options);
      }

      return await stagehand.extract(options);
    },
  }),
};

export default extractRoute;
