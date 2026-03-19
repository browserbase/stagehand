import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageWaitForSelectorActionSchema,
  PageWaitForSelectorResultSchema,
  PageWaitForSelectorRequestSchema,
  PageWaitForSelectorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const waitForSelectorRoute: RouteOptions = {
  method: "POST",
  url: "/page/waitForSelector",
  schema: {
    operationId: "PageWaitForSelector",
    summary: "page.waitForSelector",
    headers: Api.SessionHeadersSchema,
    body: PageWaitForSelectorRequestSchema,
    response: {
      200: PageWaitForSelectorResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "waitForSelector",
    actionSchema: PageWaitForSelectorActionSchema,
    execute: async ({ params }) => {
      return PageWaitForSelectorResultSchema.parse({
        selector: params.selector,
        matched: true,
      });
    },
  }),
};

export default waitForSelectorRoute;
