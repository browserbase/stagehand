import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageActionListQuerySchema,
  PageActionListResponseSchema,
  PageOperations,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "../shared.js";

const pageActionListRoute: RouteOptions = {
  method: "GET",
  url: "/page/action",
  schema: {
    ...PageOperations.PageActionList,
    querystring: PageActionListQuerySchema,
    response: {
      200: PageActionListResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "GET /v4/page/action is not implemented yet",
  ),
};

export default pageActionListRoute;
