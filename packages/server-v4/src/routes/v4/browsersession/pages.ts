import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionHeadersSchema,
  BrowserSessionPagesActionSchema,
  BrowserSessionPagesRequestSchema,
  BrowserSessionPagesResponseSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  buildBrowserSessionPage,
  createBrowserSessionActionHandler,
} from "./shared.js";

const pagesRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/pages",
  schema: {
    operationId: "BrowserSessionPages",
    summary: "browserSession.pages",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionPagesRequestSchema,
    response: {
      200: BrowserSessionPagesResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "pages",
    actionSchema: BrowserSessionPagesActionSchema,
    execute: async ({ stagehand }) => {
      return {
        result: {
          pages: stagehand.context.pages().map(buildBrowserSessionPage),
        },
      };
    },
  }),
};

export default pagesRoute;
