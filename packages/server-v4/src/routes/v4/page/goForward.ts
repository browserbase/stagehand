import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageGoForwardActionSchema,
  PageGoForwardRequestSchema,
  PageGoForwardResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const goForwardRoute: RouteOptions = {
  method: "POST",
  url: "/page/goForward",
  schema: {
    operationId: "PageGoForward",
    summary: "page.goForward",
    headers: Api.SessionHeadersSchema,
    body: PageGoForwardRequestSchema,
    response: {
      200: PageGoForwardResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "goForward",
    actionSchema: PageGoForwardActionSchema,
    execute: async ({ page, params }) => {
      const response = await page.goForward({
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

export default goForwardRoute;
