import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageScrollActionSchema,
  PageScrollRequestSchema,
  PageScrollResponseSchema,
  PageScrollResultSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

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
    execute: async () => {
      return PageScrollResultSchema.parse({ x: 0, y: 0 });
    },
  }),
};

export default scrollRoute;
