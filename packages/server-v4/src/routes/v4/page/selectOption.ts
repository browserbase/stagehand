import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageSelectOptionActionSchema,
  PageSelectOptionRequestSchema,
  PageSelectOptionResponseSchema,
  PageSelectOptionResultSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const selectOptionRoute: RouteOptions = {
  method: "POST",
  url: "/page/selectOption",
  schema: {
    operationId: "PageSelectOption",
    summary: "page.selectOption",
    headers: Api.SessionHeadersSchema,
    body: PageSelectOptionRequestSchema,
    response: {
      200: PageSelectOptionResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "selectOption",
    actionSchema: PageSelectOptionActionSchema,
    execute: async () => {
      return PageSelectOptionResultSchema.parse({ selector: {}, selected: [] });
    },
  }),
};

export default selectOptionRoute;
