import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionBrowserbaseDebugURLActionSchema,
  BrowserSessionBrowserbaseDebugURLResultSchema,
  BrowserSessionBrowserbaseDebugURLRequestSchema,
  BrowserSessionBrowserbaseDebugURLResponseSchema,
  BrowserSessionHeadersSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  createBrowserSessionActionHandler,
} from "./shared.js";

const browserbaseDebugURLRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/browserbaseDebugURL",
  schema: {
    operationId: "BrowserSessionBrowserbaseDebugURL",
    summary: "browserSession.browserbaseDebugURL",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionBrowserbaseDebugURLRequestSchema,
    response: {
      200: BrowserSessionBrowserbaseDebugURLResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "browserbaseDebugURL",
    actionSchema: BrowserSessionBrowserbaseDebugURLActionSchema,
    execute: async () => {
      return {
        result: BrowserSessionBrowserbaseDebugURLResultSchema.parse({
          browserbaseDebugURL: "https://stub.invalid/debug",
        }),
      };
    },
  }),
};

export default browserbaseDebugURLRoute;
