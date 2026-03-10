import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionHeadersSchema,
  BrowserSessionResolvePageByMainFrameIdActionSchema,
  BrowserSessionResolvePageByMainFrameIdRequestSchema,
  BrowserSessionResolvePageByMainFrameIdResponseSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  buildBrowserSessionPage,
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
    execute: async ({ stagehand, params }) => {
      const page = stagehand.context.resolvePageByMainFrameId(params.mainFrameId);
      return {
        pageId: page?.targetId(),
        result: {
          page: page ? buildBrowserSessionPage(page) : null,
        },
      };
    },
  }),
};

export default resolvePageByMainFrameIdRoute;
