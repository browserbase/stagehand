import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageScrollActionSchema,
  PageScrollRequestSchema,
  PageScrollResponseSchema,
} from "../../../schemas/v4/page.js";
import {
  createPageActionHandler,
  normalizeXPath,
  pageErrorResponses,
} from "./shared.js";

const scrollRoute: RouteOptions = {
  method: "POST",
  url: "/page/scroll",
  schema: {
    operationId: "PageScroll",
    summary: "page.scroll",
    headers: Api.SessionHeadersSchema,
    body: PageScrollRequestSchema,
    response: {
      200: PageScrollResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "scroll",
    actionSchema: PageScrollActionSchema,
    execute: async ({ page, params }) => {
      if ("selector" in params) {
        await page
          .deepLocator(normalizeXPath(params.selector.xpath))
          .scrollTo(params.percentage);

        return { xpath: params.selector.xpath };
      }

      const xpath = await page.scroll(
        params.x,
        params.y,
        params.deltaX ?? 0,
        params.deltaY,
        { returnXpath: true },
      );

      return { xpath: xpath || undefined };
    },
  }),
};

export default scrollRoute;
