import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageEvaluateActionSchema,
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
    execute: async ({ page, params }) => {
      const value = await page.evaluate(
        ({ arg, expression }: { arg: unknown; expression: string }) => {
          const localArg = arg;
          return (() => {
            const arg = localArg;
            // eslint-disable-next-line no-eval
            return eval(expression);
          })();
        },
        {
          expression: params.expression,
          arg: params.arg,
        },
      );

      return { value };
    },
  }),
};

export default evaluateRoute;
