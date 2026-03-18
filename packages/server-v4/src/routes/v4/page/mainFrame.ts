import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageMainFrameActionSchema,
  PageMainFrameResultSchema,
  PageMainFrameRequestSchema,
  PageMainFrameResponseSchema,
} from "../../../schemas/v4/page.js";
import {
  buildStubPageFrame,
  createPageActionHandler,
  getPageId,
  pageErrorResponses,
} from "./shared.js";

const mainFrameRoute: RouteOptions = {
  method: "GET",
  url: "/page/mainFrame",
  schema: {
    operationId: "PageMainFrame",
    summary: "page.mainFrame",
    headers: Api.SessionHeadersSchema,
    querystring: PageMainFrameRequestSchema,
    response: {
      200: PageMainFrameResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "mainFrame",
    actionSchema: PageMainFrameActionSchema,
    execute: async ({ params }) => {
      return PageMainFrameResultSchema.parse({
        frame: buildStubPageFrame(getPageId(params)),
      });
    },
  }),
};

export default mainFrameRoute;
