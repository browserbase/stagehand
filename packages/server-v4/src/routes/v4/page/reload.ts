import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageReloadRequestSchema,
  PageReloadResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const reloadRoute: RouteOptions = {
  method: "POST",
  url: "/page/reload",
  schema: {
    operationId: "PageReload",
    summary: "page.reload",
    body: PageReloadRequestSchema,
    response: {
      200: PageReloadResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/reload is not implemented yet",
  ),
};

export default reloadRoute;
