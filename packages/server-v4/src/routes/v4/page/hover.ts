import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageHoverActionSchema,
  PageHoverRequestSchema,
  PageHoverResponseSchema,
} from "../../../schemas/v4/page.js";
import {
  createPageActionHandler,
  normalizeXPath,
  pageErrorResponses,
} from "./shared.js";

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
    execute: async ({ page, params }) => {
      if ("selector" in params) {
        await page.deepLocator(normalizeXPath(params.selector.xpath)).hover();
        return { xpath: params.selector.xpath };
      }

      const xpath = await page.hover(params.x, params.y, {
        returnXpath: true,
      });

      return { xpath: xpath || undefined };
    },
  }),
};

export default hoverRoute;
