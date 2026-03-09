import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageActionDetailsQuerySchema,
  PageActionDetailsResponseSchema,
  PageActionIdParamsSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "../shared.js";

const pageActionDetailsRoute: RouteOptions = {
  method: "GET",
  url: "/page/action/:actionId",
  schema: {
    operationId: "PageActionDetails",
    summary: "page.actionById",
    params: PageActionIdParamsSchema,
    querystring: PageActionDetailsQuerySchema,
    response: {
      200: PageActionDetailsResponseSchema,
      400: ValidationErrorResponseSchema,
      404: V4ErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "GET /v4/page/action/:actionId is not implemented yet",
  ),
};

export default pageActionDetailsRoute;
