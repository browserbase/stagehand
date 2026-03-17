import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionHeadersSchema,
  BrowserSessionNewPageActionSchema,
  BrowserSessionNewPageRequestSchema,
  BrowserSessionNewPageResponseSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  buildBrowserSessionPage,
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
    execute: async ({ stagehand, params }) => {
      const page = await stagehand.context.newPage(params.url);
      return {
        pageId: page.targetId(),
        result: {
          page: buildBrowserSessionPage(page),
        },
      };
    },
  }),
};

export default newPageRoute;
