import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageHoverActionSchema,
  PageHoverRequestSchema,
  PageHoverResponseSchema,
  PageXPathResultSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const hoverRoute: RouteOptions = {
  method: "POST",
  url: "/page/hover",
  schema: {
    operationId: "PageHover",
    summary: "page.hover",
    headers: Api.SessionHeadersSchema,
    body: PageHoverRequestSchema,
    response: {
      200: PageHoverResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "hover",
    actionSchema: PageHoverActionSchema,
    execute: async ({ params }) => {
      return PageXPathResultSchema.parse({
        xpath:
          "selector" in params ? params.selector.xpath : "xpath=//stub-hover",
      });
    },
  }),
};

export default hoverRoute;
