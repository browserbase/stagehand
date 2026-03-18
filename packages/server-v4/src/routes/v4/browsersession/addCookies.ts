import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionAddCookiesActionSchema,
  BrowserSessionAddCookiesResultSchema,
  BrowserSessionAddCookiesRequestSchema,
  BrowserSessionAddCookiesResponseSchema,
  BrowserSessionHeadersSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  createBrowserSessionActionHandler,
} from "./shared.js";

const addCookiesRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/addCookies",
  schema: {
    operationId: "BrowserSessionAddCookies",
    summary: "browserSession.addCookies",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionAddCookiesRequestSchema,
    response: {
      200: BrowserSessionAddCookiesResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "addCookies",
    actionSchema: BrowserSessionAddCookiesActionSchema,
    execute: async ({ params }) => {
      return {
        result: BrowserSessionAddCookiesResultSchema.parse({
          added: params.cookies.length,
        }),
      };
    },
  }),
};

export default addCookiesRoute;
