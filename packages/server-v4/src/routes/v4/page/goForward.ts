import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageGoForwardActionSchema,
  PageNavigationResultSchema,
  PageGoForwardRequestSchema,
  PageGoForwardResponseSchema,
} from "../../../schemas/v4/page.js";
import {
  buildStubNavigationResult,
  createPageActionHandler,
  getPageId,
  pageErrorResponses,
} from "./shared.js";

const goForwardRoute: RouteOptions = {
  method: "POST",
  url: "/page/goForward",
  schema: {
    operationId: "PageGoForward",
    summary: "page.goForward",
    headers: Api.SessionHeadersSchema,
    body: PageGoForwardRequestSchema,
    response: {
      200: PageGoForwardResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "goForward",
    actionSchema: PageGoForwardActionSchema,
    execute: async ({ params }) => {
      return PageNavigationResultSchema.parse(
        buildStubNavigationResult(`https://stub.invalid/${getPageId(params)}`),
      );
    },
  }),
};

export default goForwardRoute;
