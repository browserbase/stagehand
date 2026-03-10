import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageMainFrameActionSchema,
  PageMainFrameRequestSchema,
  PageMainFrameResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const mainFrameRoute: RouteOptions = {
  method: "POST",
  url: "/page/mainFrame",
  schema: {
    operationId: "PageMainFrame",
    summary: "page.mainFrame",
    headers: Api.SessionHeadersSchema,
    body: PageMainFrameRequestSchema,
    response: {
      200: PageMainFrameResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "mainFrame",
    actionSchema: PageMainFrameActionSchema,
    execute: async ({ page }) => {
      const frame = page.mainFrame();

      return {
        frame: {
          frameId: frame.frameId,
          pageId: frame.pageId,
          sessionId: frame.sessionId,
          isBrowserRemote: frame.isBrowserRemote(),
        },
      };
    },
  }),
};

export default mainFrameRoute;
