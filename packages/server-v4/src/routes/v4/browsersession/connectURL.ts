import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionConnectURLActionSchema,
  BrowserSessionConnectURLResultSchema,
  BrowserSessionConnectURLRequestSchema,
  BrowserSessionConnectURLResponseSchema,
  BrowserSessionHeadersSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  createBrowserSessionActionHandler,
} from "./shared.js";

const connectURLRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/connectURL",
  schema: {
    operationId: "BrowserSessionConnectURL",
    summary: "browserSession.connectURL",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionConnectURLRequestSchema,
    response: {
      200: BrowserSessionConnectURLResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "connectURL",
    actionSchema: BrowserSessionConnectURLActionSchema,
    execute: async () => {
      return {
        result: BrowserSessionConnectURLResultSchema.parse({
          connectURL: "ws://stub.invalid/connect",
        }),
      };
    },
  }),
};

export default connectURLRoute;
