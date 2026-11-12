import { expectTypeOf } from "vitest";
import type {
  CssLocatorSelector,
  LocatorQuerySelector,
  PromptLocatorSelector,
  TextLocatorSelector,
  XPathLocatorSelector,
} from "../../types.js";

expectTypeOf<CssLocatorSelector>().toEqualTypeOf<{ type: "css"; value: string }>();
expectTypeOf<XPathLocatorSelector>().toEqualTypeOf<{ type: "xpath"; value: string }>();
expectTypeOf<TextLocatorSelector>().toEqualTypeOf<{
  type: "text";
  value: string;
}>();
expectTypeOf<LocatorQuerySelector>().toEqualTypeOf<
  CssLocatorSelector | XPathLocatorSelector | TextLocatorSelector | PromptLocatorSelector
>();
expectTypeOf<
  Extract<LocatorQuerySelector, { type: "prompt" }>
>().toEqualTypeOf<PromptLocatorSelector>();
expectTypeOf<
  Extract<LocatorQuerySelector, { type: "text" }>
>().toEqualTypeOf<TextLocatorSelector>();

// @ts-expect-error Selectors require a known discriminator.
({ type: "role", value: "button" }) satisfies LocatorQuerySelector;
// @ts-expect-error Selector values must be strings.
({ type: "text", value: 123 }) satisfies LocatorQuerySelector;
// @ts-expect-error The protocol selector type does not accept bare strings.
"button" satisfies LocatorQuerySelector;
