import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionIsBrowserbaseActionSchema,
  BrowserSessionIsBrowserbaseRequestSchema,
  BrowserSessionIsBrowserbaseResponseSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  createBrowserSessionActionHandler,
} from "./shared.js";

const isBrowserbaseRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/isBrowserbase",
  schema: {
    operationId: "BrowserSessionIsBrowserbase",
    summary: "browserSession.isBrowserbase",
    body: BrowserSessionIsBrowserbaseRequestSchema,
    response: {
      200: BrowserSessionIsBrowserbaseResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "isBrowserbase",
    actionSchema: BrowserSessionIsBrowserbaseActionSchema,
    execute: async ({ stagehand }) => {
      return {
        result: {
          isBrowserbase: stagehand.isBrowserbase,
        },
      };
    },
  }),
};

export default isBrowserbaseRoute;
