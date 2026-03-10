import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionAwaitActivePageActionSchema,
  BrowserSessionAwaitActivePageRequestSchema,
  BrowserSessionAwaitActivePageResponseSchema,
  BrowserSessionHeadersSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  buildBrowserSessionPage,
  createBrowserSessionActionHandler,
} from "./shared.js";

const awaitActivePageRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/awaitActivePage",
  schema: {
    operationId: "BrowserSessionAwaitActivePage",
    summary: "browserSession.awaitActivePage",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionAwaitActivePageRequestSchema,
    response: {
      200: BrowserSessionAwaitActivePageResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "awaitActivePage",
    actionSchema: BrowserSessionAwaitActivePageActionSchema,
    execute: async ({ stagehand, params }) => {
      const page = await stagehand.context.awaitActivePage(params.timeoutMs);
      return {
        pageId: page.targetId(),
        result: {
          page: buildBrowserSessionPage(page),
        },
      };
    },
  }),
};

export default awaitActivePageRoute;
