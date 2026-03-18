import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageGetOrdinalActionSchema,
  PageGetOrdinalResultSchema,
  PageGetOrdinalRequestSchema,
  PageGetOrdinalResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const getOrdinalRoute: RouteOptions = {
  method: "GET",
  url: "/page/getOrdinal",
  schema: {
    operationId: "PageGetOrdinal",
    summary: "page.getOrdinal",
    headers: Api.SessionHeadersSchema,
    querystring: PageGetOrdinalRequestSchema,
    response: {
      200: PageGetOrdinalResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "getOrdinal",
    actionSchema: PageGetOrdinalActionSchema,
    execute: async ({ params }) => {
      return PageGetOrdinalResultSchema.parse({
        frameId: params.frameId,
        ordinal: 0,
      });
    },
  }),
};

export default getOrdinalRoute;
