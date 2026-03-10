import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageTargetIdActionSchema,
  PageTargetIdRequestSchema,
  PageTargetIdResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const targetIdRoute: RouteOptions = {
  method: "POST",
  url: "/page/targetId",
  schema: {
    operationId: "PageTargetId",
    summary: "page.targetId",
    headers: Api.SessionHeadersSchema,
    body: PageTargetIdRequestSchema,
    response: {
      200: PageTargetIdResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "targetId",
    actionSchema: PageTargetIdActionSchema,
    execute: async ({ page }) => {
      return { targetId: page.targetId() };
    },
  }),
};

export default targetIdRoute;
