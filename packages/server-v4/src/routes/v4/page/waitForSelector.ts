import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageWaitForSelectorActionSchema,
  PageWaitForSelectorRequestSchema,
  PageWaitForSelectorResponseSchema,
} from "../../../schemas/v4/page.js";
import {
  createPageActionHandler,
  normalizeXPath,
  pageErrorResponses,
} from "./shared.js";

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
    execute: async ({ page, params }) => {
      const matched = await page.waitForSelector(
        normalizeXPath(params.selector.xpath),
        {
          state: params.state,
          timeout: params.timeout,
          pierceShadow: params.pierceShadow,
        },
      );

      return {
        selector: params.selector,
        matched,
      };
    },
  }),
};

export default waitForSelectorRoute;
