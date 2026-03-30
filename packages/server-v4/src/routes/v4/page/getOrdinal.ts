import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageGetOrdinalActionSchema,
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
    querystring: PageGetOrdinalRequestSchema,
    response: {
      200: PageGetOrdinalResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "getOrdinal",
    actionSchema: PageGetOrdinalActionSchema,
    execute: async ({ page, params }) => {
      return {
        frameId: params.frameId,
        ordinal: page.getOrdinal(params.frameId),
      };
    },
  }),
};

export default getOrdinalRoute;
