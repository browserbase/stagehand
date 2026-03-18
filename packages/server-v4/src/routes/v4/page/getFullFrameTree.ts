import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageGetFullFrameTreeActionSchema,
  PageFrameTreeResultSchema,
  PageGetFullFrameTreeRequestSchema,
  PageGetFullFrameTreeResponseSchema,
} from "../../../schemas/v4/page.js";
import {
  createPageActionHandler,
  getPageId,
  pageErrorResponses,
} from "./shared.js";

const getFullFrameTreeRoute: RouteOptions = {
  method: "GET",
  url: "/page/getFullFrameTree",
  schema: {
    operationId: "PageGetFullFrameTree",
    summary: "page.getFullFrameTree",
    headers: Api.SessionHeadersSchema,
    querystring: PageGetFullFrameTreeRequestSchema,
    response: {
      200: PageGetFullFrameTreeResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "getFullFrameTree",
    actionSchema: PageGetFullFrameTreeActionSchema,
    execute: async ({ params }) => {
      return PageFrameTreeResultSchema.parse({
        frameTree: {
          pageId: getPageId(params),
          children: [],
        },
      });
    },
  }),
};

export default getFullFrameTreeRoute;
