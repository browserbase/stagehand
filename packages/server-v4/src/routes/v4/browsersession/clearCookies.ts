import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionClearCookiesActionSchema,
  BrowserSessionClearCookiesRequestSchema,
  BrowserSessionClearCookiesResponseSchema,
  BrowserSessionHeadersSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  createBrowserSessionActionHandler,
  toStringOrRegExp,
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
    execute: async ({ stagehand, params }) => {
      const options =
        params.name || params.domain || params.path
          ? {
              name: toStringOrRegExp(params.name),
              domain: toStringOrRegExp(params.domain),
              path: toStringOrRegExp(params.path),
            }
          : undefined;
      await stagehand.context.clearCookies(options);
      return {
        result: {
          cleared: true,
        },
      };
    },
  }),
};

export default clearCookiesRoute;
