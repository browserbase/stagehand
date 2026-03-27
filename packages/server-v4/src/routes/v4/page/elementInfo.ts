import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageElementInfoActionSchema,
  PageElementInfoRequestSchema,
  PageElementInfoResponseSchema,
  PageElementInfoResultSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const elementInfoRoute: RouteOptions = {
  method: "POST",
  url: "/page/elementInfo",
  schema: {
    operationId: "PageElementInfo",
    summary: "page.elementInfo",
    headers: Api.SessionHeadersSchema,
    body: PageElementInfoRequestSchema,
    response: {
      200: PageElementInfoResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "elementInfo",
    actionSchema: PageElementInfoActionSchema,
    execute: async () => {
      return PageElementInfoResultSchema.parse({});
    },
  }),
};

export default elementInfoRoute;
