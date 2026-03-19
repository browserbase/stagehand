import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageReloadActionSchema,
  PageNavigationResultSchema,
  PageReloadRequestSchema,
  PageReloadResponseSchema,
} from "../../../schemas/v4/page.js";
import {
  buildStubNavigationResult,
  createPageActionHandler,
  getPageId,
  pageErrorResponses,
} from "./shared.js";

const reloadRoute: RouteOptions = {
  method: "POST",
  url: "/page/reload",
  schema: {
    operationId: "PageReload",
    summary: "page.reload",
    headers: Api.SessionHeadersSchema,
    body: PageReloadRequestSchema,
    response: {
      200: PageReloadResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "reload",
    actionSchema: PageReloadActionSchema,
    execute: async ({ params }) => {
      return PageNavigationResultSchema.parse(
        buildStubNavigationResult(`https://stub.invalid/${getPageId(params)}`),
      );
    },
  }),
};

export default reloadRoute;
