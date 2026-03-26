import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageClickActionSchema,
  PageClickRequestSchema,
  PageClickResponseSchema,
  PageClickResultSchema,
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
    execute: async () => {
      return PageClickResultSchema.parse({ selector: {} });
    },
  }),
};

export default clickRoute;
