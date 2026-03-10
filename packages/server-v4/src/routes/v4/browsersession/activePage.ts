import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionActivePageActionSchema,
  BrowserSessionActivePageRequestSchema,
  BrowserSessionActivePageResponseSchema,
  BrowserSessionHeadersSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  buildBrowserSessionPage,
  createBrowserSessionActionHandler,
} from "./shared.js";

const activePageRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/activePage",
  schema: {
    operationId: "BrowserSessionActivePage",
    summary: "browserSession.activePage",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionActivePageRequestSchema,
    response: {
      200: BrowserSessionActivePageResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "activePage",
    actionSchema: BrowserSessionActivePageActionSchema,
    execute: async ({ stagehand }) => {
      const page = stagehand.context.activePage();
      return {
        pageId: page?.targetId(),
        result: {
          page: page ? buildBrowserSessionPage(page) : null,
        },
      };
    },
  }),
};

export default activePageRoute;
