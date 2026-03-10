import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionBrowserbaseSessionIDActionSchema,
  BrowserSessionBrowserbaseSessionIDRequestSchema,
  BrowserSessionBrowserbaseSessionIDResponseSchema,
  BrowserSessionHeadersSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  createBrowserSessionActionHandler,
} from "./shared.js";

const browserbaseSessionIDRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/browserbaseSessionID",
  schema: {
    operationId: "BrowserSessionBrowserbaseSessionID",
    summary: "browserSession.browserbaseSessionID",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionBrowserbaseSessionIDRequestSchema,
    response: {
      200: BrowserSessionBrowserbaseSessionIDResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "browserbaseSessionID",
    actionSchema: BrowserSessionBrowserbaseSessionIDActionSchema,
    execute: async ({ stagehand }) => {
      return {
        result: {
          browserbaseSessionID: stagehand.browserbaseSessionID ?? null,
        },
      };
    },
  }),
};

export default browserbaseSessionIDRoute;
