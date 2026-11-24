import { expectTypeOf } from "vitest";
import type {
  LocatorChain,
  LocatorFrameStep,
  LocatorNthStep,
  LocatorQuerySelector,
  LocatorQueryStep,
  LocatorStep,
} from "../../types.js";

expectTypeOf<LocatorQuerySelector>().toEqualTypeOf<
  | { kind: "css"; value: string }
  | { kind: "xpath"; value: string }
  | { kind: "text"; value: string }
  | { kind: "textMatch"; value: string; exact?: boolean }
>();
expectTypeOf<LocatorQueryStep>().toEqualTypeOf<{
  type: "query";
  selector: LocatorQuerySelector;
}>();
expectTypeOf<LocatorFrameStep>().toEqualTypeOf<{
  type: "frame";
  selector: LocatorQuerySelector;
}>();
expectTypeOf<LocatorNthStep>().toEqualTypeOf<{ type: "nth"; index: number }>();
expectTypeOf<LocatorStep>().toEqualTypeOf<LocatorQueryStep | LocatorFrameStep | LocatorNthStep>();
expectTypeOf<LocatorChain["steps"]>().toEqualTypeOf<[LocatorQueryStep, ...LocatorStep[]]>();

// Position and frame steps are allowed after, but never instead of, the first query.
expectTypeOf<{ steps: [] }>().not.toExtend<LocatorChain>();
expectTypeOf<{ steps: [LocatorNthStep] }>().not.toExtend<LocatorChain>();
expectTypeOf<{ steps: [LocatorFrameStep, LocatorQueryStep] }>().not.toExtend<LocatorChain>();
expectTypeOf<{
  steps: [LocatorQueryStep, LocatorNthStep, LocatorFrameStep, LocatorQueryStep, LocatorNthStep];
}>().toExtend<LocatorChain>();
expectTypeOf<Extract<LocatorStep, { type: "query" }>>().toEqualTypeOf<LocatorQueryStep>();
expectTypeOf<Extract<LocatorStep, { type: "frame" }>>().toEqualTypeOf<LocatorFrameStep>();
expectTypeOf<Extract<LocatorStep, { type: "nth" }>>().toEqualTypeOf<LocatorNthStep>();
