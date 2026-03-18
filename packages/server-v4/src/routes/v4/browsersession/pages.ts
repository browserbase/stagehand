import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionHeadersSchema,
  BrowserSessionPagesActionSchema,
  BrowserSessionPagesResultSchema,
  BrowserSessionPagesRequestSchema,
  BrowserSessionPagesResponseSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  buildStubBrowserSessionPage,
  browserSessionActionErrorResponses,
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
    execute: async ({ sessionId }) => {
      return {
        result: BrowserSessionPagesResultSchema.parse({
          pages: [buildStubBrowserSessionPage(sessionId)],
        }),
      };
    },
  }),
};

export default pagesRoute;
