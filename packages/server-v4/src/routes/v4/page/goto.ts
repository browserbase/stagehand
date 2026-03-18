import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageGotoActionSchema,
  PageNavigationResultSchema,
  PageGotoRequestSchema,
  PageGotoResponseSchema,
} from "../../../schemas/v4/page.js";
import {
  buildStubNavigationResult,
  createPageActionHandler,
  pageErrorResponses,
} from "./shared.js";

const gotoRoute: RouteOptions = {
  method: "POST",
  url: "/page/goto",
  schema: {
    operationId: "PageGoto",
    summary: "page.goto",
    headers: Api.SessionHeadersSchema,
    body: PageGotoRequestSchema,
    response: {
      200: PageGotoResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "goto",
    actionSchema: PageGotoActionSchema,
    execute: async ({ params }) => {
      return PageNavigationResultSchema.parse(
        buildStubNavigationResult(params.url),
      );
    },
  }),
};

export default gotoRoute;
