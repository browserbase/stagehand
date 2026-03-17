import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageGoBackActionSchema,
  PageGoBackRequestSchema,
  PageGoBackResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const goBackRoute: RouteOptions = {
  method: "POST",
  url: "/page/goBack",
  schema: {
    operationId: "PageGoBack",
    summary: "page.goBack",
    headers: Api.SessionHeadersSchema,
    body: PageGoBackRequestSchema,
    response: {
      200: PageGoBackResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "goBack",
    actionSchema: PageGoBackActionSchema,
    execute: async ({ page, params }) => {
      const response = await page.goBack({
        waitUntil: params.waitUntil,
        timeoutMs: params.timeoutMs,
      });

      return {
        url: page.url(),
        response: response
          ? {
              url: response.url(),
              status: response.status(),
              statusText: response.statusText(),
              ok: response.ok(),
              headers: response.headers(),
            }
          : null,
      };
    },
  }),
};

export default goBackRoute;
