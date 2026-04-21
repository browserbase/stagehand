import type { RouteOptions } from "fastify";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  BrowserSessionHeadersSchema,
  BrowserSessionSetExtraHTTPHeadersActionSchema,
  BrowserSessionSetExtraHTTPHeadersResultSchema,
  BrowserSessionSetExtraHTTPHeadersRequestSchema,
  BrowserSessionSetExtraHTTPHeadersResponseSchema,
} from "../../../schemas/v4/browserSession.js";
import {
  browserSessionActionErrorResponses,
  createBrowserSessionActionHandler,
} from "./shared.js";

const setExtraHTTPHeadersRoute: RouteOptions = {
  method: "POST",
  url: "/browsersession/setExtraHTTPHeaders",
  schema: {
    operationId: "BrowserSessionSetExtraHTTPHeaders",
    summary: "browserSession.setExtraHTTPHeaders",
    headers: BrowserSessionHeadersSchema,
    body: BrowserSessionSetExtraHTTPHeadersRequestSchema,
    response: {
      200: BrowserSessionSetExtraHTTPHeadersResponseSchema,
      ...browserSessionActionErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createBrowserSessionActionHandler({
    method: "setExtraHTTPHeaders",
    actionSchema: BrowserSessionSetExtraHTTPHeadersActionSchema,
    execute: async ({ params }) => {
      return {
        result: BrowserSessionSetExtraHTTPHeadersResultSchema.parse({
          headers: params.headers,
        }),
      };
    },
  }),
};

export default setExtraHTTPHeadersRoute;
