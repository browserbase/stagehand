import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageEvaluateActionSchema,
  PageEvaluateResultSchema,
  PageEvaluateRequestSchema,
  PageEvaluateResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const evaluateRoute: RouteOptions = {
  method: "POST",
  url: "/page/evaluate",
  schema: {
    operationId: "PageEvaluate",
    summary: "page.evaluate",
    headers: Api.SessionHeadersSchema,
    body: PageEvaluateRequestSchema,
    response: {
      200: PageEvaluateResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "evaluate",
    actionSchema: PageEvaluateActionSchema,
    execute: async ({ params }) => {
      return PageEvaluateResultSchema.parse({
        value: {
          expression: params.expression,
          arg: params.arg ?? null,
        },
      });
    },
  }),
};

export default evaluateRoute;
