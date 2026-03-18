import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionAddInitScriptActionSchema,
  BrowserSessionAddInitScriptResultSchema,
  BrowserSessionAddInitScriptRequestSchema,
  BrowserSessionAddInitScriptResponseSchema,
  BrowserSessionHeadersSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  createBrowserSessionActionHandler,
} from "./shared.js";

const addInitScriptRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/addInitScript",
  schema: {
    operationId: "BrowserSessionAddInitScript",
    summary: "browserSession.addInitScript",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionAddInitScriptRequestSchema,
    response: {
      200: BrowserSessionAddInitScriptResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "addInitScript",
    actionSchema: BrowserSessionAddInitScriptActionSchema,
    execute: async () => {
      return {
        result: BrowserSessionAddInitScriptResultSchema.parse({ added: true }),
      };
    },
  }),
};

export default addInitScriptRoute;
