import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionBrowserbaseSessionURLActionSchema,
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
    execute: async ({ stagehand }) => {
      return {
        result: {
          browserbaseSessionURL: stagehand.browserbaseSessionURL ?? null,
        },
      };
    },
  }),
};

export default browserbaseSessionURLRoute;
