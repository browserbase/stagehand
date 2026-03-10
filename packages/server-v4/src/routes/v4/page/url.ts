import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageUrlActionSchema,
  PageUrlRequestSchema,
  PageUrlResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const urlRoute: RouteOptions = {
  method: "GET",
  url: "/page/url",
  schema: {
    operationId: "PageUrl",
    summary: "page.url",
    headers: Api.SessionHeadersSchema,
    querystring: PageUrlRequestSchema,
    response: {
      200: PageUrlResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "url",
    actionSchema: PageUrlActionSchema,
    execute: async ({ page }) => {
      return { url: page.url() };
    },
  }),
};

export default urlRoute;
