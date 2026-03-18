import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageListAllFrameIdsActionSchema,
  PageListAllFrameIdsResultSchema,
  PageListAllFrameIdsRequestSchema,
  PageListAllFrameIdsResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const listAllFrameIdsRoute: RouteOptions = {
  method: "GET",
  url: "/page/listAllFrameIds",
  schema: {
    operationId: "PageListAllFrameIds",
    summary: "page.listAllFrameIds",
    headers: Api.SessionHeadersSchema,
    querystring: PageListAllFrameIdsRequestSchema,
    response: {
      200: PageListAllFrameIdsResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "listAllFrameIds",
    actionSchema: PageListAllFrameIdsActionSchema,
    execute: async () => {
      return PageListAllFrameIdsResultSchema.parse({
        frameIds: ["frame_stub"],
      });
    },
  }),
};

export default listAllFrameIdsRoute;
