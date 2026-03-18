import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageTitleActionSchema,
  PageTitleResultSchema,
  PageTitleRequestSchema,
  PageTitleResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const titleRoute: RouteOptions = {
  method: "GET",
  url: "/page/title",
  schema: {
    operationId: "PageTitle",
    summary: "page.title",
    headers: Api.SessionHeadersSchema,
    querystring: PageTitleRequestSchema,
    response: {
      200: PageTitleResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "title",
    actionSchema: PageTitleActionSchema,
    execute: async () => {
      return PageTitleResultSchema.parse({ title: "Stub title" });
    },
  }),
};

export default titleRoute;
