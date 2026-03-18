import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageCloseActionSchema,
  PageCloseResultSchema,
  PageCloseRequestSchema,
  PageCloseResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const closeRoute: RouteOptions = {
  method: "POST",
  url: "/page/close",
  schema: {
    operationId: "PageClose",
    summary: "page.close",
    headers: Api.SessionHeadersSchema,
    body: PageCloseRequestSchema,
    response: {
      200: PageCloseResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "close",
    actionSchema: PageCloseActionSchema,
    execute: async () => {
      return PageCloseResultSchema.parse({ closed: true });
    },
  }),
};

export default closeRoute;
