import { expectTypeOf } from "vite-plus/test";
import type { z } from "zod/v4";
import { buildStagehandProtocolRequest, parseStagehandProtocolResponse } from "../src/index.js";
import type {
  ContextPagesResultSchema,
  LocatorClickResultSchema,
  LocatorFillParamsSchema,
  LocatorIsVisibleResultSchema,
  PageGotoParamsSchema,
  PageUrlResultSchema,
} from "../../protocol/schemas.js";
import type {
  StagehandMethod,
  StagehandMethodParams,
  StagehandMethodResult,
  StagehandProtocolClient,
  StagehandProtocolRequest,
} from "../src/index.js";

expectTypeOf<StagehandMethod>().toEqualTypeOf<
  | "ping"
  | "runtime.configure"
  | "runtime.loopback_status"
  | "browser.get_version"
  | "stagehand.init"
  | "stagehand.close"
  | "stagehand.act"
  | "stagehand.observe"
  | "stagehand.extract"
  | "stagehand.metrics"
  | "context.pages"
  | "context.new_page"
  | "page.goto"
  | "page.url"
  | "page.title"
  | "page.close"
  | "locator.click"
  | "locator.fill"
  | "locator.is_visible"
  | "locator.text_content"
>();

expectTypeOf<StagehandMethodParams<"page.goto">>().toEqualTypeOf<
  z.output<typeof PageGotoParamsSchema>
>();

expectTypeOf<StagehandMethodResult<"page.url">>().toEqualTypeOf<
  z.output<typeof PageUrlResultSchema>
>();

expectTypeOf<StagehandMethodParams<"locator.fill">>().toEqualTypeOf<
  z.output<typeof LocatorFillParamsSchema>
>();

expectTypeOf<StagehandMethodResult<"locator.is_visible">>().toEqualTypeOf<
  z.output<typeof LocatorIsVisibleResultSchema>
>();

declare const client: StagehandProtocolClient;

declare const request: StagehandProtocolRequest;

expectTypeOf(client.send(request)).toEqualTypeOf<Promise<unknown>>();

expectTypeOf(buildStagehandProtocolRequest("context.pages", {})).toEqualTypeOf<
  Extract<StagehandProtocolRequest, { method: "context.pages" }>
>();

expectTypeOf(parseStagehandProtocolResponse("context.pages", {})).toEqualTypeOf<
  z.output<typeof ContextPagesResultSchema>
>();

expectTypeOf(
  buildStagehandProtocolRequest("locator.click", {
    pageId: "page-1",
    selector: "button",
    options: {
      button: "left",
      clickCount: 1,
    },
  }),
).toEqualTypeOf<Extract<StagehandProtocolRequest, { method: "locator.click" }>>();

expectTypeOf(parseStagehandProtocolResponse("locator.click", {})).toEqualTypeOf<
  z.output<typeof LocatorClickResultSchema>
>();
