import { expectTypeOf } from "vitest";
import type { Locator, LocatorFilterOptions } from "../src/index.js";

expectTypeOf<Parameters<Locator["filter"]>>().toEqualTypeOf<[options?: LocatorFilterOptions]>();
expectTypeOf<ReturnType<Locator["filter"]>>().toEqualTypeOf<Locator>();
expectTypeOf<LocatorFilterOptions>().toEqualTypeOf<{ hasText?: string; hasNotText?: string }>();
expectTypeOf<RegExp>().not.toExtend<LocatorFilterOptions["hasText"]>();
expectTypeOf<RegExp>().not.toExtend<LocatorFilterOptions["hasNotText"]>();
expectTypeOf<"has" | "hasNot" | "exact">().not.toExtend<keyof LocatorFilterOptions>();
