import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionActivePageActionSchema,
  BrowserSessionOptionalPageResultSchema,
  BrowserSessionActivePageRequestSchema,
  BrowserSessionActivePageResponseSchema,
  BrowserSessionHeadersSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  buildStubBrowserSessionPage,
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
    execute: async ({ sessionId }) => {
      const page = buildStubBrowserSessionPage(sessionId);
      return {
        pageId: page.pageId,
        result: BrowserSessionOptionalPageResultSchema.parse({ page }),
      };
    },
  }),
};

export default activePageRoute;
