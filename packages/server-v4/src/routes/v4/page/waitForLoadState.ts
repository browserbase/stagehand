import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageWaitForLoadStateActionSchema,
  PageWaitForLoadStateRequestSchema,
  PageWaitForLoadStateResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const waitForLoadStateRoute: RouteOptions = {
  method: "POST",
  url: "/page/waitForLoadState",
  schema: {
    operationId: "PageWaitForLoadState",
    summary: "page.waitForLoadState",
    headers: Api.SessionHeadersSchema,
    body: PageWaitForLoadStateRequestSchema,
    response: {
      200: PageWaitForLoadStateResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "waitForLoadState",
    actionSchema: PageWaitForLoadStateActionSchema,
    execute: async ({ page, params }) => {
      await page.waitForLoadState(params.state, params.timeoutMs);
      return { state: params.state };
    },
  }),
};

export default waitForLoadStateRoute;
