import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageKeyPressActionSchema,
  PageKeyPressResultSchema,
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
    execute: async ({ params }) => {
      return PageKeyPressResultSchema.parse({ key: params.key });
    },
  }),
};

export default keyPressRoute;
