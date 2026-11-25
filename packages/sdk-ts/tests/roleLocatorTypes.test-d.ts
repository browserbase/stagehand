import { expectTypeOf } from "vitest";
import type { AriaRole, GetByRoleOptions, Locator, Page } from "../src/index.js";

expectTypeOf<Parameters<Page["getByRole"]>[0]>().toEqualTypeOf<AriaRole>();
expectTypeOf<Parameters<Locator["getByRole"]>[0]>().toEqualTypeOf<AriaRole>();
expectTypeOf<Parameters<Page["getByRole"]>[1]>().toEqualTypeOf<GetByRoleOptions | undefined>();
expectTypeOf<Parameters<Locator["getByRole"]>[1]>().toEqualTypeOf<GetByRoleOptions | undefined>();
expectTypeOf<ReturnType<Page["getByRole"]>>().toEqualTypeOf<Locator>();
expectTypeOf<ReturnType<Locator["getByRole"]>>().toEqualTypeOf<Locator>();
expectTypeOf<"button">().toExtend<AriaRole>();
expectTypeOf<"Button">().not.toExtend<AriaRole>();
expectTypeOf<string>().not.toExtend<AriaRole>();
expectTypeOf<RegExp>().not.toExtend<GetByRoleOptions["name"]>();
expectTypeOf<"includeHidden">().not.toExtend<keyof GetByRoleOptions>();
expectTypeOf<GetByRoleOptions["pressed"]>().toEqualTypeOf<boolean | "mixed" | undefined>();
