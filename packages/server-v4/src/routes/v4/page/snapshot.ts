import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageSnapshotActionSchema,
  PageSnapshotResultSchema,
  PageSnapshotRequestSchema,
  PageSnapshotResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

const snapshotRoute: RouteOptions = {
  method: "POST",
  url: "/page/snapshot",
  schema: {
    operationId: "PageSnapshot",
    summary: "page.snapshot",
    headers: Api.SessionHeadersSchema,
    body: PageSnapshotRequestSchema,
    response: {
      200: PageSnapshotResponseSchema,
      ...pageErrorResponses,
    },
  } satisfies FastifyZodOpenApiSchema,
  handler: createPageActionHandler({
    method: "snapshot",
    actionSchema: PageSnapshotActionSchema,
    execute: async () => {
      return PageSnapshotResultSchema.parse({
        formattedTree: "stub tree",
        xpathMap: { stub: "//html" },
        urlMap: { stub: "https://stub.invalid" },
      });
    },
  }),
};

export default snapshotRoute;
