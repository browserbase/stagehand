import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionHeadersSchema,
  BrowserSessionResolvePageByMainFrameIdActionSchema,
  BrowserSessionOptionalPageResultSchema,
  BrowserSessionResolvePageByMainFrameIdRequestSchema,
  BrowserSessionResolvePageByMainFrameIdResponseSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  buildStubBrowserSessionPage,
  createBrowserSessionActionHandler,
} from "./shared.js";

const resolvePageByMainFrameIdRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/resolvePageByMainFrameId",
  schema: {
    operationId: "BrowserSessionResolvePageByMainFrameId",
    summary: "browserSession.resolvePageByMainFrameId",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionResolvePageByMainFrameIdRequestSchema,
    response: {
      200: BrowserSessionResolvePageByMainFrameIdResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "resolvePageByMainFrameId",
    actionSchema: BrowserSessionResolvePageByMainFrameIdActionSchema,
    execute: async ({ sessionId }) => {
      const page = buildStubBrowserSessionPage(sessionId);
      return {
        pageId: page.pageId,
        result: BrowserSessionOptionalPageResultSchema.parse({ page }),
      };
    },
  }),
};

export default resolvePageByMainFrameIdRoute;
