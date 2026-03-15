import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageClickActionSchema,
  PageClickRequestSchema,
  PageClickResponseSchema,
} from "../../../schemas/v4/page.js";
import {
  createPageActionHandler,
  normalizeXPath,
  pageErrorResponses,
} from "./shared.js";

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
    execute: async ({ page, params }) => {
      if ("selector" in params) {
        await page.deepLocator(normalizeXPath(params.selector.xpath)).click({
          button: params.button,
          clickCount: params.clickCount,
        });

        return { xpath: params.selector.xpath };
      }

      const xpath = await page.click(params.x, params.y, {
        button: params.button,
        clickCount: params.clickCount,
        returnXpath: true,
      });

      return { xpath: xpath || undefined };
    },
  }),
};

export default clickRoute;
