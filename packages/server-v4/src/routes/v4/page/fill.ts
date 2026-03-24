import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageFillActionSchema,
  PageFillRequestSchema,
  PageFillResponseSchema,
  PageFillResultSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const fillRoute: RouteOptions = {
  method: "POST",
  url: "/page/fill",
  schema: {
    operationId: "PageFill",
    summary: "page.fill",
    headers: Api.SessionHeadersSchema,
    body: PageFillRequestSchema,
    response: {
      200: PageFillResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "fill",
    actionSchema: PageFillActionSchema,
    execute: async () => {
      return PageFillResultSchema.parse({ selector: {}, value: "" });
    },
  }),
};

export default fillRoute;
