import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionGetFullFrameTreeByMainFrameIdActionSchema,
  BrowserSessionFrameTreeResultSchema,
  BrowserSessionGetFullFrameTreeByMainFrameIdRequestSchema,
  BrowserSessionGetFullFrameTreeByMainFrameIdResponseSchema,
  BrowserSessionHeadersSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  createBrowserSessionActionHandler,
} from "./shared.js";

const getFullFrameTreeByMainFrameIdRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/getFullFrameTreeByMainFrameId",
  schema: {
    operationId: "BrowserSessionGetFullFrameTreeByMainFrameId",
    summary: "browserSession.getFullFrameTreeByMainFrameId",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionGetFullFrameTreeByMainFrameIdRequestSchema,
    response: {
      200: BrowserSessionGetFullFrameTreeByMainFrameIdResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "getFullFrameTreeByMainFrameId",
    actionSchema: BrowserSessionGetFullFrameTreeByMainFrameIdActionSchema,
    execute: async ({ params }) => {
      return {
        pageId: "page_stub",
        result: BrowserSessionFrameTreeResultSchema.parse({
          frameTree: { mainFrameId: params.mainFrameId, children: [] },
        }),
      };
    },
  }),
};

export default getFullFrameTreeByMainFrameIdRoute;
