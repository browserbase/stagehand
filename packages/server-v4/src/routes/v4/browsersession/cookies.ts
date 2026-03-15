import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionCookiesActionSchema,
  BrowserSessionCookiesRequestSchema,
  BrowserSessionCookiesResponseSchema,
  BrowserSessionHeadersSchema,
} from "../../../schemas/v4/browserSession.js";
import {
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
    execute: async ({ stagehand, params }) => {
      return {
        result: {
          cookies: await stagehand.context.cookies(params.urls),
        },
      };
    },
  }),
};

export default cookiesRoute;
