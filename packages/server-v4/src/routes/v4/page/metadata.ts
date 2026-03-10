import type { RouteOptions } from "fastify";
import { Api } from "@browserbasehq/stagehand";
import type { FastifyZodOpenApiSchema } from "fastify-zod-openapi";

import {
  PageAddInitScriptActionSchema,
  PageAddInitScriptRequestSchema,
  PageAddInitScriptResponseSchema,
  PageAsProtocolFrameTreeActionSchema,
  PageAsProtocolFrameTreeRequestSchema,
  PageAsProtocolFrameTreeResponseSchema,
  PageEnableCursorOverlayActionSchema,
  PageEnableCursorOverlayRequestSchema,
  PageEnableCursorOverlayResponseSchema,
  PageFramesActionSchema,
  PageFramesRequestSchema,
  PageFramesResponseSchema,
  PageGetOrdinalActionSchema,
  PageGetOrdinalRequestSchema,
  PageGetOrdinalResponseSchema,
  PageGetFullFrameTreeActionSchema,
  PageGetFullFrameTreeRequestSchema,
  PageGetFullFrameTreeResponseSchema,
  PageListAllFrameIdsActionSchema,
  PageListAllFrameIdsRequestSchema,
  PageListAllFrameIdsResponseSchema,
  PageMainFrameActionSchema,
  PageMainFrameIdActionSchema,
  PageMainFrameIdRequestSchema,
  PageMainFrameIdResponseSchema,
  PageMainFrameRequestSchema,
  PageMainFrameResponseSchema,
  PageSetExtraHTTPHeadersActionSchema,
  PageSetExtraHTTPHeadersRequestSchema,
  PageSetExtraHTTPHeadersResponseSchema,
  PageTargetIdActionSchema,
  PageTargetIdRequestSchema,
  PageTargetIdResponseSchema,
  PageTitleActionSchema,
  PageTitleRequestSchema,
  PageTitleResponseSchema,
  PageUrlActionSchema,
  PageUrlRequestSchema,
  PageUrlResponseSchema,
  PageWaitForMainLoadStateActionSchema,
  PageWaitForMainLoadStateRequestSchema,
  PageWaitForMainLoadStateResponseSchema,
} from "../../../schemas/v4/page.js";
import { createPageActionHandler, pageErrorResponses } from "./shared.js";

export const metadataRoutes: RouteOptions[] = [
  {
    method: "POST",
    url: "/page/enableCursorOverlay",
    schema: {
      operationId: "PageEnableCursorOverlay",
      summary: "page.enableCursorOverlay",
      headers: Api.SessionHeadersSchema,
      body: PageEnableCursorOverlayRequestSchema,
      response: {
        200: PageEnableCursorOverlayResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "enableCursorOverlay",
      actionSchema: PageEnableCursorOverlayActionSchema,
      execute: async ({ page }) => {
        await page.enableCursorOverlay();
        return { enabled: true };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/addInitScript",
    schema: {
      operationId: "PageAddInitScript",
      summary: "page.addInitScript",
      headers: Api.SessionHeadersSchema,
      body: PageAddInitScriptRequestSchema,
      response: {
        200: PageAddInitScriptResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "addInitScript",
      actionSchema: PageAddInitScriptActionSchema,
      execute: async ({ page, params }) => {
        await page.addInitScript(params.script);
        return { added: true };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/targetId",
    schema: {
      operationId: "PageTargetId",
      summary: "page.targetId",
      headers: Api.SessionHeadersSchema,
      body: PageTargetIdRequestSchema,
      response: {
        200: PageTargetIdResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "targetId",
      actionSchema: PageTargetIdActionSchema,
      execute: async ({ page }) => {
        return { targetId: page.targetId() };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/mainFrameId",
    schema: {
      operationId: "PageMainFrameId",
      summary: "page.mainFrameId",
      headers: Api.SessionHeadersSchema,
      body: PageMainFrameIdRequestSchema,
      response: {
        200: PageMainFrameIdResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "mainFrameId",
      actionSchema: PageMainFrameIdActionSchema,
      execute: async ({ page }) => {
        return { mainFrameId: page.mainFrameId() };
      },
    }),
  },
  {
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
  },
  {
    method: "POST",
    url: "/page/getFullFrameTree",
    schema: {
      operationId: "PageGetFullFrameTree",
      summary: "page.getFullFrameTree",
      headers: Api.SessionHeadersSchema,
      body: PageGetFullFrameTreeRequestSchema,
      response: {
        200: PageGetFullFrameTreeResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "getFullFrameTree",
      actionSchema: PageGetFullFrameTreeActionSchema,
      execute: async ({ page }) => {
        return { frameTree: page.getFullFrameTree() };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/asProtocolFrameTree",
    schema: {
      operationId: "PageAsProtocolFrameTree",
      summary: "page.asProtocolFrameTree",
      headers: Api.SessionHeadersSchema,
      body: PageAsProtocolFrameTreeRequestSchema,
      response: {
        200: PageAsProtocolFrameTreeResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "asProtocolFrameTree",
      actionSchema: PageAsProtocolFrameTreeActionSchema,
      execute: async ({ page, params }) => {
        return {
          frameTree: page.asProtocolFrameTree(params.rootMainFrameId),
        };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/title",
    schema: {
      operationId: "PageTitle",
      summary: "page.title",
      headers: Api.SessionHeadersSchema,
      body: PageTitleRequestSchema,
      response: {
        200: PageTitleResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "title",
      actionSchema: PageTitleActionSchema,
      execute: async ({ page }) => {
        return { title: await page.title() };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/listAllFrameIds",
    schema: {
      operationId: "PageListAllFrameIds",
      summary: "page.listAllFrameIds",
      headers: Api.SessionHeadersSchema,
      body: PageListAllFrameIdsRequestSchema,
      response: {
        200: PageListAllFrameIdsResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "listAllFrameIds",
      actionSchema: PageListAllFrameIdsActionSchema,
      execute: async ({ page }) => {
        return { frameIds: page.listAllFrameIds() };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/getOrdinal",
    schema: {
      operationId: "PageGetOrdinal",
      summary: "page.getOrdinal",
      headers: Api.SessionHeadersSchema,
      body: PageGetOrdinalRequestSchema,
      response: {
        200: PageGetOrdinalResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "getOrdinal",
      actionSchema: PageGetOrdinalActionSchema,
      execute: async ({ page, params }) => {
        return {
          frameId: params.frameId,
          ordinal: page.getOrdinal(params.frameId),
        };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/url",
    schema: {
      operationId: "PageUrl",
      summary: "page.url",
      headers: Api.SessionHeadersSchema,
      body: PageUrlRequestSchema,
      response: {
        200: PageUrlResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "url",
      actionSchema: PageUrlActionSchema,
      execute: async ({ page }) => {
        return { url: page.url() };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/frames",
    schema: {
      operationId: "PageFrames",
      summary: "page.frames",
      headers: Api.SessionHeadersSchema,
      body: PageFramesRequestSchema,
      response: {
        200: PageFramesResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "frames",
      actionSchema: PageFramesActionSchema,
      execute: async ({ page }) => {
        return {
          frames: page.frames().map((frame) => ({
            frameId: frame.frameId,
            pageId: frame.pageId,
            sessionId: frame.sessionId,
            isBrowserRemote: frame.isBrowserRemote(),
          })),
        };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/setExtraHTTPHeaders",
    schema: {
      operationId: "PageSetExtraHTTPHeaders",
      summary: "page.setExtraHTTPHeaders",
      headers: Api.SessionHeadersSchema,
      body: PageSetExtraHTTPHeadersRequestSchema,
      response: {
        200: PageSetExtraHTTPHeadersResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "setExtraHTTPHeaders",
      actionSchema: PageSetExtraHTTPHeadersActionSchema,
      execute: async ({ page, params }) => {
        await page.setExtraHTTPHeaders(params.headers);
        return { headers: params.headers };
      },
    }),
  },
  {
    method: "POST",
    url: "/page/waitForMainLoadState",
    schema: {
      operationId: "PageWaitForMainLoadState",
      summary: "page.waitForMainLoadState",
      headers: Api.SessionHeadersSchema,
      body: PageWaitForMainLoadStateRequestSchema,
      response: {
        200: PageWaitForMainLoadStateResponseSchema,
        ...pageErrorResponses,
      },
    } satisfies FastifyZodOpenApiSchema,
    handler: createPageActionHandler({
      method: "waitForMainLoadState",
      actionSchema: PageWaitForMainLoadStateActionSchema,
      execute: async ({ page, params }) => {
        await page.waitForMainLoadState(params.state, params.timeoutMs);
        return { state: params.state };
      },
    }),
  },
];
