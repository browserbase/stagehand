import { expectTypeOf } from "vitest";
import type {
  CssLocatorSelector,
  LegacyLocatorSelector,
  LocatorSelector,
  TextLocatorSelector,
  XPathLocatorSelector,
} from "../../types.js";

expectTypeOf<CssLocatorSelector>().toEqualTypeOf<{ type: "css"; value: string }>();
expectTypeOf<XPathLocatorSelector>().toEqualTypeOf<{ type: "xpath"; value: string }>();
expectTypeOf<TextLocatorSelector>().toEqualTypeOf<{
  type: "text";
  value: string;
}>();
expectTypeOf<LegacyLocatorSelector>().toEqualTypeOf<{ type: "legacy"; value: string }>();
expectTypeOf<LocatorSelector>().toEqualTypeOf<
  CssLocatorSelector | XPathLocatorSelector | TextLocatorSelector | LegacyLocatorSelector
>();
expectTypeOf<Extract<LocatorSelector, { type: "text" }>>().toEqualTypeOf<TextLocatorSelector>();

// @ts-expect-error Selectors require a known discriminator.
({ type: "role", value: "button" }) satisfies LocatorSelector;
// @ts-expect-error Selector values must be strings.
({ type: "text", value: 123 }) satisfies LocatorSelector;
// @ts-expect-error The protocol selector type does not accept bare strings.
"button" satisfies LocatorSelector;
