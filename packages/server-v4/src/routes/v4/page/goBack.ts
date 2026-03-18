import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageGoBackActionSchema,
  PageNavigationResultSchema,
  PageGoBackRequestSchema,
  PageGoBackResponseSchema,
} from "../../../schemas/v4/page.js";
import {
  buildStubNavigationResult,
  createPageActionHandler,
  getPageId,
  pageErrorResponses,
} from "./shared.js";

const goBackRoute: RouteOptions = {
  method: "POST",
  url: "/page/goBack",
  schema: {
    operationId: "PageGoBack",
    summary: "page.goBack",
    headers: Api.SessionHeadersSchema,
    body: PageGoBackRequestSchema,
    response: {
      200: PageGoBackResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "goBack",
    actionSchema: PageGoBackActionSchema,
    execute: async ({ params }) => {
      return PageNavigationResultSchema.parse(
        buildStubNavigationResult(`https://stub.invalid/${getPageId(params)}`),
      );
    },
  }),
};

export default goBackRoute;
