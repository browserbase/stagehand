import type { RouteOptions } from "fastify";
import type { ActOptions } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  StagehandActRequestSchema,
  StagehandActResponseSchema,
  type StagehandActParams,
} from "../../../schemas/v4/stagehand.js";
import {
  createStagehandRouteHandler,
  normalizeStagehandModel,
  resolveStagehandPage,
  stagehandErrorResponses,
} from "./shared.js";

const actRoute: RouteOptions = {
  method: "POST",
  url: "/stagehand/act",
  schema: {
    operationId: "StagehandAct",
    summary: "stagehand.act",
    body: StagehandActRequestSchema,
    response: {
      200: StagehandActResponseSchema,
      ...stagehandErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createStagehandRouteHandler<StagehandActParams>({
    eventType: "StagehandAct",
    execute: async ({ params, stagehand }) => {
      const page = await resolveStagehandPage(stagehand, params.frameId);
      const options: ActOptions = {
        ...params.options,
        page,
        ...(params.options?.model !== undefined
          ? {
              model: normalizeStagehandModel(
                params.options.model,
              ) as ActOptions["model"],
            }
          : {}),
      };

      return typeof params.input === "string"
        ? await stagehand.act(params.input, options)
        : await stagehand.act(params.input, options);
    },
  }),
};

export default actRoute;
