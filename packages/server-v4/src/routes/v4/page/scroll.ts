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
    execute: async ({ params }) => {
      const sel = params.selector;
      const x = "x" in sel ? sel.x : 0;
      const y = "y" in sel ? sel.y : 0;
      return PageScrollResultSchema.parse({ x, y });
    },
  }),
};

export default scrollRoute;
