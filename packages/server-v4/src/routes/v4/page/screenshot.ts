import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageScreenshotActionSchema,
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
    execute: async ({ page, params }) => {
      const buffer = await page.screenshot({
        fullPage: params.fullPage,
        clip: params.clip,
        type: params.type,
        quality: params.quality,
        scale: params.scale,
        animations: params.animations,
        caret: params.caret,
        style: params.style,
        omitBackground: params.omitBackground,
        timeout: params.timeout,
      });

      return {
        base64: buffer.toString("base64"),
        mimeType: params.type === "jpeg" ? "image/jpeg" : "image/png",
      };
    },
  }),
};

export default screenshotRoute;
