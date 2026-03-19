import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageSetExtraHTTPHeadersActionSchema,
  PageSetExtraHTTPHeadersResultSchema,
  PageSetExtraHTTPHeadersRequestSchema,
  PageSetExtraHTTPHeadersResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const setExtraHTTPHeadersRoute: RouteOptions = {
  method: "POST",
  url: "/page/setExtraHTTPHeaders",
  schema: {
    operationId: "PageSetExtraHTTPHeaders",
    summary: "page.setExtraHTTPHeaders",
    headers: Api.SessionHeadersSchema,
    body: PageSetExtraHTTPHeadersRequestSchema,
    response: {
      200: PageSetExtraHTTPHeadersResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "setExtraHTTPHeaders",
    actionSchema: PageSetExtraHTTPHeadersActionSchema,
    execute: async ({ params }) => {
      return PageSetExtraHTTPHeadersResultSchema.parse({
        headers: params.headers,
      });
    },
  }),
};

export default setExtraHTTPHeadersRoute;
