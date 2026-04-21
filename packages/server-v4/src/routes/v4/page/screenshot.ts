import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageScreenshotActionSchema,
  PageScreenshotResultSchema,
  PageScreenshotRequestSchema,
  PageScreenshotResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const screenshotRoute: RouteOptions = {
  method: "POST",
  url: "/page/screenshot",
  schema: {
    operationId: "PageScreenshot",
    summary: "page.screenshot",
    headers: Api.SessionHeadersSchema,
    body: PageScreenshotRequestSchema,
    response: {
      200: PageScreenshotResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "screenshot",
    actionSchema: PageScreenshotActionSchema,
    execute: async ({ params }) => {
      return PageScreenshotResultSchema.parse({
        base64: "c3R1Yg==",
        mimeType: params.type === "jpeg" ? "image/jpeg" : "image/png",
      });
    },
  }),
};

export default screenshotRoute;
