import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageActionListQuerySchema,
  PageActionListResponseSchema,
} from "../../../../schemas/v4/page.js";
import { pageActionListHandler, pageErrorResponses } from "../shared.js";

const pageActionListRoute: RouteOptions = {
  method: "GET",
  url: "/page/action",
  schema: {
    operationId: "PageActionList",
    summary: "page.action",
    headers: Api.SessionHeadersSchema,
    querystring: PageActionListQuerySchema,
    response: {
      200: PageActionListResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: pageActionListHandler,
};

export default pageActionListRoute;
