import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageReloadActionSchema,
  PageReloadRequestSchema,
  PageReloadResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const reloadRoute: RouteOptions = {
  method: "POST",
  url: "/page/reload",
  schema: {
    operationId: "PageReload",
    summary: "page.reload",
    headers: Api.SessionHeadersSchema,
    body: PageReloadRequestSchema,
    response: {
      200: PageReloadResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "reload",
    actionSchema: PageReloadActionSchema,
    execute: async ({ page, params }) => {
      const response = await page.reload({
        waitUntil: params.waitUntil,
        timeoutMs: params.timeoutMs,
        ignoreCache: params.ignoreCache,
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

export default reloadRoute;
