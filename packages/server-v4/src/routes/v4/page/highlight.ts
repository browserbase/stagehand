import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageHighlightActionSchema,
  PageHighlightRequestSchema,
  PageHighlightResponseSchema,
  PageHighlightResultSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const highlightRoute: RouteOptions = {
  method: "POST",
  url: "/page/highlight",
  schema: {
    operationId: "PageHighlight",
    summary: "page.highlight",
    headers: Api.SessionHeadersSchema,
    body: PageHighlightRequestSchema,
    response: {
      200: PageHighlightResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "highlight",
    actionSchema: PageHighlightActionSchema,
    execute: async () => {
      return PageHighlightResultSchema.parse({
        selector: {},
        highlighted: false,
      });
    },
  }),
};

export default highlightRoute;
