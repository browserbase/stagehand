import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionBrowserbaseSessionIDActionSchema,
  BrowserSessionBrowserbaseSessionIDResultSchema,
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
    execute: async () => {
      return {
        result: BrowserSessionBrowserbaseSessionIDResultSchema.parse({
          browserbaseSessionID: "bb_session_stub",
        }),
      };
    },
  }),
};

export default browserbaseSessionIDRoute;
