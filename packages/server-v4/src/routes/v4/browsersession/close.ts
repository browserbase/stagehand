import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionCloseActionSchema,
  BrowserSessionCloseRequestSchema,
  BrowserSessionCloseResponseSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  createBrowserSessionActionHandler,
} from "./shared.js";

const closeRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/close",
  schema: {
    operationId: "BrowserSessionClose",
    summary: "browserSession.close",
    body: BrowserSessionCloseRequestSchema,
    response: {
      200: BrowserSessionCloseResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "close",
    actionSchema: BrowserSessionCloseActionSchema,
    execute: async ({ sessionId, sessionStore }) => {
      await sessionStore.endSession(sessionId);
      return {
        result: {
          closed: true,
        },
      };
    },
  }),
};

export default closeRoute;
