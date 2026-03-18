import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageWaitForTimeoutActionSchema,
  PageWaitForTimeoutResultSchema,
  PageWaitForTimeoutRequestSchema,
  PageWaitForTimeoutResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const waitForTimeoutRoute: RouteOptions = {
  method: "POST",
  url: "/page/waitForTimeout",
  schema: {
    operationId: "PageWaitForTimeout",
    summary: "page.waitForTimeout",
    headers: Api.SessionHeadersSchema,
    body: PageWaitForTimeoutRequestSchema,
    response: {
      200: PageWaitForTimeoutResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "waitForTimeout",
    actionSchema: PageWaitForTimeoutActionSchema,
    execute: async ({ params }) => {
      return PageWaitForTimeoutResultSchema.parse({ ms: params.ms });
    },
  }),
};

export default waitForTimeoutRoute;
