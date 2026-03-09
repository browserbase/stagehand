import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageSnapshotRequestSchema,
  PageSnapshotResponseSchema,
  ValidationErrorResponseSchema,
  V4ErrorResponseSchema,
} from "../../../schemas/v4/page.js";
import { createNotImplementedHandler } from "./shared.js";

const snapshotRoute: RouteOptions = {
  method: "POST",
  url: "/page/snapshot",
  schema: {
    operationId: "PageSnapshot",
    summary: "page.snapshot",
    body: PageSnapshotRequestSchema,
    response: {
      200: PageSnapshotResponseSchema,
      400: ValidationErrorResponseSchema,
      501: V4ErrorResponseSchema,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createNotImplementedHandler(
    "POST /v4/page/snapshot is not implemented yet",
  ),
};

export default snapshotRoute;
