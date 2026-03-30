import type { RouteOptions } from "fastify";
import type { ObserveOptions } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  StagehandObserveRequestSchema,
  StagehandObserveResponseSchema,
  type StagehandObserveParams,
} from "../../../schemas/v4/stagehand.js";
import {
  createStagehandRouteHandler,
  normalizeStagehandModel,
  resolveStagehandPage,
  stagehandErrorResponses,
} from "./shared.js";

const observeRoute: RouteOptions = {
  method: "POST",
  url: "/stagehand/observe",
  schema: {
    operationId: "StagehandObserve",
    summary: "stagehand.observe",
    body: StagehandObserveRequestSchema,
    response: {
      200: StagehandObserveResponseSchema,
      ...stagehandErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createStagehandRouteHandler<StagehandObserveParams>({
    eventType: "StagehandObserve",
    execute: async ({ params, stagehand }) => {
      const page = await resolveStagehandPage(stagehand, params.frameId);
      const options: ObserveOptions = {
        ...params.options,
        page,
        ...(params.options?.model !== undefined
          ? {
              model: normalizeStagehandModel(
                params.options.model,
              ) as ObserveOptions["model"],
            }
          : {}),
      };

      if (params.instruction) {
        return await stagehand.observe(params.instruction, options);
      }

      return await stagehand.observe(options);
    },
  }),
};

export default observeRoute;
