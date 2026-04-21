import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageSetViewportSizeActionSchema,
  PageSetViewportSizeResultSchema,
  PageSetViewportSizeRequestSchema,
  PageSetViewportSizeResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const setViewportSizeRoute: RouteOptions = {
  method: "POST",
  url: "/page/setViewportSize",
  schema: {
    operationId: "PageSetViewportSize",
    summary: "page.setViewportSize",
    headers: Api.SessionHeadersSchema,
    body: PageSetViewportSizeRequestSchema,
    response: {
      200: PageSetViewportSizeResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "setViewportSize",
    actionSchema: PageSetViewportSizeActionSchema,
    execute: async ({ params }) => {
      return PageSetViewportSizeResultSchema.parse({
        width: params.width,
        height: params.height,
        deviceScaleFactor: params.deviceScaleFactor,
      });
    },
  }),
};

export default setViewportSizeRoute;
