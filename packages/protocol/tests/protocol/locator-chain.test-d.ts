import { expectTypeOf } from "vitest";
import type {
  CssLocatorSelector,
  LocatorChain,
  LocatorFrameStep,
  LocatorQuerySelector,
  LocatorQueryStep,
  LocatorStep,
  TextLocatorSelector,
  PromptLocatorSelector,
  XPathLocatorSelector,
} from "../../types.js";

expectTypeOf<LocatorQuerySelector>().toEqualTypeOf<
  CssLocatorSelector | XPathLocatorSelector | TextLocatorSelector | PromptLocatorSelector
>();
expectTypeOf<LocatorStep>().toEqualTypeOf<LocatorQueryStep | LocatorFrameStep>();
expectTypeOf<LocatorChain["steps"]>().toEqualTypeOf<LocatorStep[]>();
expectTypeOf<Extract<LocatorStep, { type: "frame" }>>().toEqualTypeOf<LocatorFrameStep>();

// @ts-expect-error The SDK must normalize legacy selectors before constructing a chain.
({ type: "legacy", value: "iframe >> text=Pay" }) satisfies LocatorQuerySelector;
