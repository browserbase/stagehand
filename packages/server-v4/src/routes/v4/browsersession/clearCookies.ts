import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionClearCookiesActionSchema,
  BrowserSessionClearCookiesResultSchema,
  BrowserSessionClearCookiesRequestSchema,
  BrowserSessionClearCookiesResponseSchema,
  BrowserSessionHeadersSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  createBrowserSessionActionHandler,
} from "./shared.js";

const clearCookiesRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/clearCookies",
  schema: {
    operationId: "BrowserSessionClearCookies",
    summary: "browserSession.clearCookies",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionClearCookiesRequestSchema,
    response: {
      200: BrowserSessionClearCookiesResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "clearCookies",
    actionSchema: BrowserSessionClearCookiesActionSchema,
    execute: async () => {
      return {
        result: BrowserSessionClearCookiesResultSchema.parse({ cleared: true }),
      };
    },
  }),
};

export default clearCookiesRoute;
