import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionActionDetailsQuerySchema,
  BrowserSessionActionDetailsResponseSchema,
  BrowserSessionActionIdParamsSchema,
  BrowserSessionHeadersSchema,
} from "../../../../schemas/v4/browserSession.js";
import {
  browserSessionActionDetailsHandler,
  browserSessionActionErrorResponses,
} from "../shared.js";

const browserSessionActionDetailsRoute: RouteOptions = {
  method: "GET",
  url: "/browsersession/action/:actionId",
  schema: {
    operationId: "BrowserSessionActionDetails",
    summary: "browserSession.action",
    headers: BrowserSessionHeadersSchema,
    params: BrowserSessionActionIdParamsSchema,
    querystring: BrowserSessionActionDetailsQuerySchema,
    response: {
      200: BrowserSessionActionDetailsResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: browserSessionActionDetailsHandler,
};

export default browserSessionActionDetailsRoute;
