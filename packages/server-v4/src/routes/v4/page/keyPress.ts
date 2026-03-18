import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageKeyPressActionSchema,
  PageKeyPressRequestSchema,
  PageKeyPressResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const keyPressRoute: RouteOptions = {
  method: "POST",
  url: "/page/keyPress",
  schema: {
    operationId: "PageKeyPress",
    summary: "page.keyPress",
    headers: Api.SessionHeadersSchema,
    body: PageKeyPressRequestSchema,
    response: {
      200: PageKeyPressResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "keyPress",
    actionSchema: PageKeyPressActionSchema,
    execute: async ({ page, params }) => {
      await page.keyPress(params.key, {
        delay: params.delay,
      });

      return { key: params.key };
    },
  }),
};

export default keyPressRoute;
