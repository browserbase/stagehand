import { expectTypeOf } from "vitest";
import type {
  CssLocatorSelector,
  XPathLocatorSelector,
  TextLocatorSelector,
  LegacyLocatorSelector,
  LocatorSelector,
  LocatorInput,
  Locator,
  Page,
} from "../src/index.js";

expectTypeOf<LocatorSelector>().toEqualTypeOf<
  CssLocatorSelector | XPathLocatorSelector | TextLocatorSelector | LegacyLocatorSelector
>();
expectTypeOf<LocatorInput>().toEqualTypeOf<string | LocatorSelector>();
expectTypeOf<Parameters<Page["locator"]>[0]>().toEqualTypeOf<LocatorInput>();

declare const page: Page;
const css: CssLocatorSelector = { type: "css", value: "button" };
const xpath: XPathLocatorSelector = { type: "xpath", value: "//button" };
const text: TextLocatorSelector = { type: "text", value: "Pay" };
const legacy: LegacyLocatorSelector = { type: "legacy", value: "iframe >> text=Pay" };
expectTypeOf(page.locator(css)).toEqualTypeOf<Locator>();
page.locator(xpath);
page.locator(text);
page.locator(legacy);
page.locator("button");

// @ts-expect-error A structured selector requires its value.
page.locator({ type: "text" });
// @ts-expect-error Selector values must be strings.
page.locator({ type: "text", value: 123 });
// @ts-expect-error The discriminator must name a supported engine.
page.locator({ type: "unknown", value: "button" });
