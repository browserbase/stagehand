import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  StagehandNavigateRequestSchema,
  StagehandNavigateResponseSchema,
  type StagehandNavigateParams,
} from "../../../schemas/v4/stagehand.js";
import {
  createStagehandRouteHandler,
  resolveStagehandPage,
  stagehandErrorResponses,
} from "./shared.js";

const navigateRoute: RouteOptions = {
  method: "POST",
  url: "/stagehand/navigate",
  schema: {
    operationId: "StagehandNavigate",
    summary: "stagehand.navigate",
    body: StagehandNavigateRequestSchema,
    response: {
      200: StagehandNavigateResponseSchema,
      ...stagehandErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createStagehandRouteHandler<StagehandNavigateParams>({
    eventType: "StagehandNavigate",
    execute: async ({ params, stagehand }) => {
      const page = await resolveStagehandPage(stagehand, params.frameId);
      return await page.goto(params.url, params.options);
    },
  }),
};

export default navigateRoute;
