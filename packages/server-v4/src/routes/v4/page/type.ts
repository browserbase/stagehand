import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageTypeActionSchema,
  PageTypeResultSchema,
  PageTypeRequestSchema,
  PageTypeResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const typeRoute: RouteOptions = {
  method: "POST",
  url: "/page/type",
  schema: {
    operationId: "PageType",
    summary: "page.type",
    headers: Api.SessionHeadersSchema,
    body: PageTypeRequestSchema,
    response: {
      200: PageTypeResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "type",
    actionSchema: PageTypeActionSchema,
    execute: async ({ params }) => {
      return PageTypeResultSchema.parse({ text: params.text });
    },
  }),
};

export default typeRoute;
