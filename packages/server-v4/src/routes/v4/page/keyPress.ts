import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageKeyPressRequestSchema,
  PageKeyPressResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const keyPressRoute: RouteOptions = {
  method: "POST",
  url: "/page/keyPress",
  schema: {
    operationId: "PageKeyPress",
    summary: "page.keyPress",
    body: PageKeyPressRequestSchema,
    response: {
      200: PageKeyPressResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/keyPress is not implemented yet",
  ),
};

export default keyPressRoute;
