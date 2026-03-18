import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageAsProtocolFrameTreeActionSchema,
  PageFrameTreeResultSchema,
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
    headers: Api.SessionHeadersSchema,
    querystring: PageAsProtocolFrameTreeRequestSchema,
    response: {
      200: PageAsProtocolFrameTreeResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "asProtocolFrameTree",
    actionSchema: PageAsProtocolFrameTreeActionSchema,
    execute: async ({ params }) => {
      return PageFrameTreeResultSchema.parse({
        frameTree: {
          rootMainFrameId: params.rootMainFrameId,
          children: [],
        },
      });
    },
  }),
};

export default asProtocolFrameTreeRoute;
