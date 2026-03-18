import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageTargetIdActionSchema,
  PageTargetIdResultSchema,
  PageTargetIdRequestSchema,
  PageTargetIdResponseSchema,
} from "../../../schemas/v4/page.js";
import {
  createPageActionHandler,
  getPageId,
  pageErrorResponses,
} from "./shared.js";

const targetIdRoute: RouteOptions = {
  method: "GET",
  url: "/page/targetId",
  schema: {
    operationId: "PageTargetId",
    summary: "page.targetId",
    headers: Api.SessionHeadersSchema,
    querystring: PageTargetIdRequestSchema,
    response: {
      200: PageTargetIdResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "targetId",
    actionSchema: PageTargetIdActionSchema,
    execute: async ({ params }) => {
      return PageTargetIdResultSchema.parse({
        targetId: getPageId(params),
      });
    },
  }),
};

export default targetIdRoute;
