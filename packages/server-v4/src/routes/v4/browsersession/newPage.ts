import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionHeadersSchema,
  BrowserSessionNewPageActionSchema,
  BrowserSessionPageResultSchema,
  BrowserSessionNewPageRequestSchema,
  BrowserSessionNewPageResponseSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  buildStubBrowserSessionPage,
  createBrowserSessionActionHandler,
} from "./shared.js";

const newPageRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/newPage",
  schema: {
    operationId: "BrowserSessionNewPage",
    summary: "browserSession.newPage",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionNewPageRequestSchema,
    response: {
      200: BrowserSessionNewPageResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "newPage",
    actionSchema: BrowserSessionNewPageActionSchema,
    execute: async ({ sessionId, params }) => {
      const page = buildStubBrowserSessionPage(sessionId, { url: params.url });
      return {
        pageId: page.pageId,
        result: BrowserSessionPageResultSchema.parse({ page }),
      };
    },
  }),
};

export default newPageRoute;
