import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageGetFullFrameTreeActionSchema,
  PageGetFullFrameTreeRequestSchema,
  PageGetFullFrameTreeResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const getFullFrameTreeRoute: RouteOptions = {
  method: "POST",
  url: "/page/getFullFrameTree",
  schema: {
    operationId: "PageGetFullFrameTree",
    summary: "page.getFullFrameTree",
    headers: Api.SessionHeadersSchema,
    body: PageGetFullFrameTreeRequestSchema,
    response: {
      200: PageGetFullFrameTreeResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "getFullFrameTree",
    actionSchema: PageGetFullFrameTreeActionSchema,
    execute: async ({ page }) => {
      return { frameTree: page.getFullFrameTree() };
    },
  }),
};

export default getFullFrameTreeRoute;
