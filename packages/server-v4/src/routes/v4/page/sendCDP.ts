import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageSendCDPRequestSchema,
  PageSendCDPResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const sendCDPRoute: RouteOptions = {
  method: "POST",
  url: "/page/sendCDP",
  schema: {
    operationId: "PageSendCDP",
    summary: "page.sendCDP",
    body: PageSendCDPRequestSchema,
    response: {
      200: PageSendCDPResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/sendCDP is not implemented yet",
  ),
};

export default sendCDPRoute;
