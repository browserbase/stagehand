import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionIsAdvancedStealthActionSchema,
  BrowserSessionIsAdvancedStealthRequestSchema,
  BrowserSessionIsAdvancedStealthResponseSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  createBrowserSessionActionHandler,
} from "./shared.js";

const isAdvancedStealthRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/isAdvancedStealth",
  schema: {
    operationId: "BrowserSessionIsAdvancedStealth",
    summary: "browserSession.isAdvancedStealth",
    body: BrowserSessionIsAdvancedStealthRequestSchema,
    response: {
      200: BrowserSessionIsAdvancedStealthResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "isAdvancedStealth",
    actionSchema: BrowserSessionIsAdvancedStealthActionSchema,
    execute: async ({ stagehand }) => {
      return {
        result: {
          isAdvancedStealth: stagehand.isAdvancedStealth,
        },
      };
    },
  }),
};

export default isAdvancedStealthRoute;
