import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionBrowserbaseSessionURLActionSchema,
  BrowserSessionBrowserbaseSessionURLResultSchema,
  BrowserSessionBrowserbaseSessionURLRequestSchema,
  BrowserSessionBrowserbaseSessionURLResponseSchema,
  BrowserSessionHeadersSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  createBrowserSessionActionHandler,
} from "./shared.js";

const browserbaseSessionURLRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/browserbaseSessionURL",
  schema: {
    operationId: "BrowserSessionBrowserbaseSessionURL",
    summary: "browserSession.browserbaseSessionURL",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionBrowserbaseSessionURLRequestSchema,
    response: {
      200: BrowserSessionBrowserbaseSessionURLResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "browserbaseSessionURL",
    actionSchema: BrowserSessionBrowserbaseSessionURLActionSchema,
    execute: async () => {
      return {
        result: BrowserSessionBrowserbaseSessionURLResultSchema.parse({
          browserbaseSessionURL: "https://browserbase.com/sessions/stub",
        }),
      };
    },
  }),
};

export default browserbaseSessionURLRoute;
