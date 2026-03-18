import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionAwaitActivePageActionSchema,
  BrowserSessionPageResultSchema,
  BrowserSessionAwaitActivePageRequestSchema,
  BrowserSessionAwaitActivePageResponseSchema,
  BrowserSessionHeadersSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  buildStubBrowserSessionPage,
  createBrowserSessionActionHandler,
} from "./shared.js";

const awaitActivePageRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/awaitActivePage",
  schema: {
    operationId: "BrowserSessionAwaitActivePage",
    summary: "browserSession.awaitActivePage",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionAwaitActivePageRequestSchema,
    response: {
      200: BrowserSessionAwaitActivePageResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "awaitActivePage",
    actionSchema: BrowserSessionAwaitActivePageActionSchema,
    execute: async ({ sessionId }) => {
      const page = buildStubBrowserSessionPage(sessionId);
      return {
        pageId: page.pageId,
        result: BrowserSessionPageResultSchema.parse({ page }),
      };
    },
  }),
};

export default awaitActivePageRoute;
