import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageGotoActionSchema,
  PageGotoRequestSchema,
  PageGotoResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const gotoRoute: RouteOptions = {
  method: "POST",
  url: "/page/goto",
  schema: {
    operationId: "PageGoto",
    summary: "page.goto",
    headers: Api.SessionHeadersSchema,
    body: PageGotoRequestSchema,
    response: {
      200: PageGotoResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "goto",
    actionSchema: PageGotoActionSchema,
    execute: async ({ page, params }) => {
      const response = await page.goto(params.url, {
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

export default gotoRoute;
