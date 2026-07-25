import { expectTypeOf } from "vitest";
import * as NodeVariant from "../src/runtime/node/index.js";
import * as WebVariant from "../src/runtime/web/index.js";

expectTypeOf<Extract<NodeVariant.BrowserSource, { type: "local" }>>().not.toEqualTypeOf<never>();
expectTypeOf<Extract<WebVariant.BrowserSource, { type: "local" }>>().toEqualTypeOf<never>();
expectTypeOf<
  ConstructorParameters<typeof NodeVariant.Stagehand>[0]
>().toEqualTypeOf<NodeVariant.StagehandClientInitParams>();
expectTypeOf<
  ConstructorParameters<typeof WebVariant.Stagehand>[0]
>().toEqualTypeOf<WebVariant.StagehandClientInitParams>();
