import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionSetViewportSizeActionSchema,
  BrowserSessionSetViewportSizeRequestSchema,
  BrowserSessionSetViewportSizeResponseSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  createBrowserSessionActionHandler,
} from "./shared.js";

const setViewportSizeRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/setViewportSize",
  schema: {
    operationId: "BrowserSessionSetViewportSize",
    summary: "browserSession.setViewportSize",
    body: BrowserSessionSetViewportSizeRequestSchema,
    response: {
      200: BrowserSessionSetViewportSizeResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "setViewportSize",
    actionSchema: BrowserSessionSetViewportSizeActionSchema,
    execute: async ({ stagehand, params }) => {
      const page = await stagehand.context.awaitActivePage();
      await page.setViewportSize(params.width, params.height, {
        deviceScaleFactor: params.deviceScaleFactor,
      });
      return {
        pageId: page.targetId(),
        result: {
          width: params.width,
          height: params.height,
          ...(params.deviceScaleFactor !== undefined
            ? { deviceScaleFactor: params.deviceScaleFactor }
            : {}),
        },
      };
    },
  }),
};

export default setViewportSizeRoute;
