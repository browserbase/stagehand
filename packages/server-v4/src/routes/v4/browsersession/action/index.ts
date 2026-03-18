import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionActionListQuerySchema,
  BrowserSessionActionListResponseSchema,
  BrowserSessionHeadersSchema,
} from "../../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  browserSessionActionListHandler,
} from "../shared.js";

const browserSessionActionListRoute: RouteOptions = {
  method: "GET",
  url: "/browsersession/action",
  schema: {
    operationId: "BrowserSessionActionList",
    summary: "browserSession.actions",
    headers: BrowserSessionHeadersSchema,
    querystring: BrowserSessionActionListQuerySchema,
    response: {
      200: BrowserSessionActionListResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: browserSessionActionListHandler,
};

export default browserSessionActionListRoute;
