import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionCookiesActionSchema,
  BrowserSessionCookiesResultSchema,
  BrowserSessionCookiesRequestSchema,
  BrowserSessionCookiesResponseSchema,
  BrowserSessionHeadersSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  buildStubBrowserSessionCookie,
  browserSessionActionErrorResponses,
  createBrowserSessionActionHandler,
} from "./shared.js";

const cookiesRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/cookies",
  schema: {
    operationId: "BrowserSessionCookies",
    summary: "browserSession.cookies",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionCookiesRequestSchema,
    response: {
      200: BrowserSessionCookiesResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "cookies",
    actionSchema: BrowserSessionCookiesActionSchema,
    execute: async () => {
      return {
        result: BrowserSessionCookiesResultSchema.parse({
          cookies: [buildStubBrowserSessionCookie()],
        }),
      };
    },
  }),
};

export default cookiesRoute;
