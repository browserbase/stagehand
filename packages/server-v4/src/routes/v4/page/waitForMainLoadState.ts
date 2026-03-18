import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageWaitForMainLoadStateActionSchema,
  PageWaitForLoadStateResultSchema,
  PageWaitForMainLoadStateRequestSchema,
  PageWaitForMainLoadStateResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const waitForMainLoadStateRoute: RouteOptions = {
  method: "POST",
  url: "/page/waitForMainLoadState",
  schema: {
    operationId: "PageWaitForMainLoadState",
    summary: "page.waitForMainLoadState",
    headers: Api.SessionHeadersSchema,
    body: PageWaitForMainLoadStateRequestSchema,
    response: {
      200: PageWaitForMainLoadStateResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "waitForMainLoadState",
    actionSchema: PageWaitForMainLoadStateActionSchema,
    execute: async ({ params }) => {
      return PageWaitForLoadStateResultSchema.parse({
        state: params.state,
      });
    },
  }),
};

export default waitForMainLoadStateRoute;
