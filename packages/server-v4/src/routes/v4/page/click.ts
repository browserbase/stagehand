import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageClickActionSchema,
  PageClickRequestSchema,
  PageClickResponseSchema,
  PageXPathResultSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const clickRoute: RouteOptions = {
  method: "POST",
  url: "/page/click",
  schema: {
    operationId: "PageClick",
    summary: "page.click",
    headers: Api.SessionHeadersSchema,
    body: PageClickRequestSchema,
    response: {
      200: PageClickResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "click",
    actionSchema: PageClickActionSchema,
    execute: async ({ params }) => {
      return PageXPathResultSchema.parse({
        xpath:
          "selector" in params ? params.selector.xpath : "xpath=//stub-click",
      });
    },
  }),
};

export default clickRoute;
