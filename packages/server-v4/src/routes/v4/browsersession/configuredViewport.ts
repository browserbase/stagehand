import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionConfiguredViewportActionSchema,
  BrowserSessionConfiguredViewportRequestSchema,
  BrowserSessionConfiguredViewportResponseSchema,
  BrowserSessionHeadersSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  createBrowserSessionActionHandler,
} from "./shared.js";

const configuredViewportRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/configuredViewport",
  schema: {
    operationId: "BrowserSessionConfiguredViewport",
    summary: "browserSession.configuredViewport",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionConfiguredViewportRequestSchema,
    response: {
      200: BrowserSessionConfiguredViewportResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "configuredViewport",
    actionSchema: BrowserSessionConfiguredViewportActionSchema,
    execute: async ({ stagehand }) => {
      return {
        result: stagehand.configuredViewport,
      };
    },
  }),
};

export default configuredViewportRoute;
