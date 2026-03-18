import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageActionDetailsQuerySchema,
  PageActionDetailsResponseSchema,
  PageActionIdParamsSchema,
} from "../../../../schemas/v4/page.js";
import { pageActionDetailsHandler, pageErrorResponses } from "../shared.js";

const pageActionDetailsRoute: RouteOptions = {
  method: "GET",
  url: "/page/action/:actionId",
  schema: {
    operationId: "PageActionDetails",
    summary: "page.actionById",
    headers: Api.SessionHeadersSchema,
    params: PageActionIdParamsSchema,
    querystring: PageActionDetailsQuerySchema,
    response: {
      200: PageActionDetailsResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: pageActionDetailsHandler,
};

export default pageActionDetailsRoute;
