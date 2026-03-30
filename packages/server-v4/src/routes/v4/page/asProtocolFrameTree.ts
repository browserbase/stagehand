import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageAsProtocolFrameTreeActionSchema,
  PageAsProtocolFrameTreeRequestSchema,
  PageAsProtocolFrameTreeResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const asProtocolFrameTreeRoute: RouteOptions = {
  method: "GET",
  url: "/page/asProtocolFrameTree",
  schema: {
    operationId: "PageAsProtocolFrameTree",
    summary: "page.asProtocolFrameTree",
    querystring: PageAsProtocolFrameTreeRequestSchema,
    response: {
      200: PageAsProtocolFrameTreeResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "asProtocolFrameTree",
    actionSchema: PageAsProtocolFrameTreeActionSchema,
    execute: async ({ page, params }) => {
      return {
        frameTree: page.asProtocolFrameTree(params.rootMainFrameId),
      };
    },
  }),
};

export default asProtocolFrameTreeRoute;
